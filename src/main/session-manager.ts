import { randomUUID } from 'node:crypto';
import type { Dimensions, Disposable, PtyProcess, TerminalEvent } from '../shared/terminal-protocol.ts';

const HIGH_WATER = 128 * 1024;
const LOW_WATER = 32 * 1024;
const MAX_BUFFER = 1024 * 1024;
const MAX_INPUT = 256 * 1024;
const MAX_SESSIONS = 32;

interface Session {
  owner: number;
  cwd?: string;
  agent?: string;
  pty: PtyProcess;
  ready: boolean;
  ended: boolean;
  paused: boolean;
  sequence: number;
  pending: number;
  outstanding: Map<number, number>;
  queue: TerminalEvent[];
  subscriptions: Disposable[];
}

export function validateDimensions(cols: number, rows: number): void {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || cols > 1000 || rows < 1 || rows > 500) {
    throw new Error('Invalid terminal dimensions (2–1000 columns, 1–500 rows).');
  }
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private layouts = new Map<number, { ids: string[]; active?: string }>();
  private spawn: (size: Dimensions, cwd?: string) => PtyProcess;
  private currentDirectory: (pid: number) => string | undefined;
  private notify: (owner: number, event: TerminalEvent) => void;
  private terminate: (pty: PtyProcess) => void;

  constructor(spawn: (size: Dimensions, cwd?: string) => PtyProcess, notify: (owner: number, event: TerminalEvent) => void, terminate: (pty: PtyProcess) => void,
    currentDirectory: (pid: number) => string | undefined = () => undefined) {
    this.spawn = spawn; this.notify = notify; this.terminate = terminate;
    this.currentDirectory = currentDirectory;
  }

  create(owner: number, size: Dimensions, sourceId?: string, cwd?: string): string {
    if (!size || typeof size !== 'object') throw new Error('Invalid terminal dimensions.');
    if (cwd !== undefined && typeof cwd !== 'string') throw new Error('Invalid starting directory.');
    validateDimensions(size.cols, size.rows);
    if ([...this.sessions.values()].filter(s => s.owner === owner).length >= MAX_SESSIONS) {
      throw new Error('Close a tab before opening another (maximum 32 tabs).');
    }
    const source = sourceId === undefined ? undefined : this.owned(owner, sourceId);
    // A source tab wins, falling back to its last polled directory if the lookup times out;
    // the spawner decides whether a requested directory is usable.
    const pty = this.spawn(size, source ? (source.ended ? undefined : this.currentDirectory(source.pty.pid) ?? source.cwd) : cwd);
    const id = randomUUID();
    const session: Session = {
      owner, pty, ready: false, ended: false, paused: false, sequence: 0,
      pending: 0, outstanding: new Map(), queue: [], subscriptions: [],
    };
    this.sessions.set(id, session);
    session.subscriptions.push(pty.onData(data => {
      if (session.ended || !this.sessions.has(id)) return;
      if (session.pending + data.length > MAX_BUFFER) {
        this.finish(id, session, { exitCode: 1, error: 'Session stopped because output exceeded the safety buffer.' });
        this.terminate(pty);
        return;
      }
      const sequence = ++session.sequence;
      session.pending += data.length;
      session.outstanding.set(sequence, data.length);
      if (session.pending >= HIGH_WATER && !session.paused) {
        session.paused = true; pty.pause();
      }
      this.deliver(session, { type: 'data', id, sequence, data });
    }));
    session.subscriptions.push(pty.onExit(event => this.finish(id, session, event)));
    return id;
  }

  ready(owner: number, id: string): void {
    const session = this.owned(owner, id);
    if (session.ready) return;
    session.ready = true;
    for (const event of session.queue.splice(0)) this.notify(owner, event);
  }

  write(owner: number, id: string, data: string, binary: boolean): void {
    const session = this.owned(owner, id);
    if (session.ended) throw new Error('The shell has exited. Open a new tab.');
    if (typeof data !== 'string' || data.length > MAX_INPUT || typeof binary !== 'boolean') throw new Error('Invalid terminal input.');
    if (binary && [...data].some(char => char.charCodeAt(0) > 255)) throw new Error('Invalid binary input.');
    session.pty.write(binary ? Buffer.from(data, 'binary') : data);
  }

  resize(owner: number, id: string, cols: number, rows: number): void {
    const session = this.owned(owner, id);
    validateDimensions(cols, rows);
    if (!session.ended) session.pty.resize(cols, rows);
  }

  ack(owner: number, id: string, sequence: number): void {
    const session = this.owned(owner, id);
    if (!Number.isSafeInteger(sequence)) return;
    const size = session.outstanding.get(sequence);
    if (size === undefined || !session.ready) return;
    session.outstanding.delete(sequence);
    session.pending -= size;
    if (session.paused && session.pending < LOW_WATER && !session.ended) {
      session.paused = false; session.pty.resume();
    }
  }

  close(owner: number, id: string): void {
    if (!this.sessions.has(id)) return;
    const session = this.owned(owner, id);
    this.sessions.delete(id);
    for (const subscription of session.subscriptions) subscription.dispose();
    session.queue = [];
    session.outstanding.clear();
    if (!session.ended) this.terminate(session.pty);
  }

  closeOwner(owner: number): void {
    for (const [id, session] of this.sessions) if (session.owner === owner) this.close(owner, id);
    this.layouts.delete(owner);
  }

  /** Records the renderer's sidebar order; unknown or foreign IDs are ignored. */
  arrange(owner: number, ids: unknown, active: unknown): void {
    if (!Array.isArray(ids) || ids.length > MAX_SESSIONS) return;
    const owned = ids.filter((id): id is string => typeof id === 'string' && this.sessions.get(id)?.owner === owner);
    this.layouts.set(owner, { ids: owned, ...(typeof active === 'string' && owned.includes(active) ? { active } : {}) });
  }

  /** Live tabs in sidebar order with fresh directories, for reopening after an update restart. */
  tabsOf(owner: number): { tabs: { pid: number; cwd?: string; agent?: string }[]; active: number } {
    const layout = this.layouts.get(owner);
    const order = [...new Set([...(layout?.ids ?? []), ...this.sessions.keys()])].filter(id => {
      const session = this.sessions.get(id);
      return session?.owner === owner && !session.ended;
    });
    const tabs = order.map(id => {
      const { pty, cwd, agent } = this.sessions.get(id)!;
      const current = this.currentDirectory(pty.pid) ?? cwd;
      return { pid: pty.pid, ...(current ? { cwd: current } : {}), ...(agent ? { agent } : {}) };
    });
    return { tabs, active: Math.max(0, order.indexOf(layout?.active ?? '')) };
  }

  get tabCount(): number {
    // Exited shells still occupy tabs until the user closes them.
    return this.sessions.size;
  }

  directory(owner: number, id: string): string | undefined {
    const session = this.owned(owner, id);
    const cwd = session.ended ? undefined : this.currentDirectory(session.pty.pid);
    if (cwd && cwd !== session.cwd) {
      session.cwd = cwd;
      this.deliver(session, { type: 'directory', id, cwd });
    }
    return session.cwd;
  }

  /** One batched lookup for every live shell; missing entries keep the previous directory. */
  async refreshDirectories(read: (pids: number[]) => Promise<Map<number, string>>): Promise<void> {
    const live = [...this.sessions].filter(([, session]) => !session.ended);
    if (!live.length) return;
    const directories = await read(live.map(([, session]) => session.pty.pid));
    for (const [id, session] of live) {
      const cwd = directories.get(session.pty.pid);
      if (!cwd || session.ended || this.sessions.get(id) !== session || cwd === session.cwd) continue;
      session.cwd = cwd;
      this.deliver(session, { type: 'directory', id, cwd });
    }
  }

  async refreshAgents(read: () => Promise<((pid: number) => string | undefined) | undefined>): Promise<void> {
    const agentOf = await read();
    if (!agentOf) return;
    for (const [id, session] of this.sessions) {
      const agent = session.ended ? undefined : agentOf(session.pty.pid);
      if (agent === session.agent) continue;
      session.agent = agent;
      this.deliver(session, agent ? { type: 'agent', id, agent } : { type: 'agent', id });
    }
  }

  private owned(owner: number, id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner) throw new Error('Unknown terminal session.');
    return session;
  }

  private deliver(session: Session, event: TerminalEvent): void {
    if (session.ready) this.notify(session.owner, event);
    else session.queue.push(event);
  }

  private finish(id: string, session: Session, result: { exitCode: number; signal?: number; error?: string }): void {
    if (session.ended || !this.sessions.has(id)) return;
    session.ended = true;
    this.deliver(session, { type: 'exit', id, ...result });
  }
}
