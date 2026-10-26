import { accessSync, constants, statSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import type { Dimensions, Preferences, PtyProcess } from '../shared/terminal-protocol.ts';

const execFileAsync = promisify(execFile);

/** Poll without blocking terminal input while lsof inspects the shell. */
export async function shellCurrentDirectoryAsync(pid: number): Promise<string | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 1) return undefined;
  try {
    const { stdout } = await execFileAsync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-F0n'], {
      encoding: 'utf8', timeout: 1000, maxBuffer: 64 * 1024,
    });
    return directoryFromLsof(stdout);
  } catch { return undefined; }
}

function directoryFromLsof(output: string): string | undefined {
  const cwd = output.split('\0').find(field => field.startsWith('n'))?.slice(1);
  if (!cwd || !isAbsolute(cwd) || cwd.length > 4096 || /[\x00-\x1f]/.test(cwd) || !statSync(cwd).isDirectory()) return undefined;
  accessSync(cwd, constants.R_OK | constants.X_OK);
  return cwd;
}

/** Query the shell itself so this also works without shell integration hooks. */
export function shellCurrentDirectory(pid: number): string | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 1) return undefined;
  try {
    const output = execFileSync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-F0n'], {
      encoding: 'utf8', timeout: 1000, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return directoryFromLsof(output);
  } catch { return undefined; }
}

export function buildShellLaunch(preferences: Preferences, size: Dimensions, inherited: NodeJS.ProcessEnv) {
  try { accessSync(preferences.shell, constants.X_OK); }
  catch { throw new Error(`Cannot run shell: ${preferences.shell}. Update the shell path in Settings.`); }
  try { if (!statSync(preferences.cwd).isDirectory()) throw new Error(); accessSync(preferences.cwd, constants.R_OK | constants.X_OK); }
  catch { throw new Error(`Cannot open starting directory: ${preferences.cwd}. Update it in Settings.`); }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (value !== undefined && !key.startsWith('ELECTRON_') && key !== 'NODE_OPTIONS' && key !== 'NODE_CHANNEL_FD') env[key] = value;
  }
  Object.assign(env, { TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Y-Term', TERM_PROGRAM_VERSION: '0.1.0' });
  const args = ['zsh', 'bash', 'sh', 'fish'].includes(basename(preferences.shell)) ? ['-l', '-i'] : [];
  return { file: preferences.shell, args, options: { name: 'xterm-256color', cols: size.cols, rows: size.rows, cwd: preferences.cwd, env } };
}

export function descendantsOf(parent: number, snapshot: string): number[] {
  const children = new Map<number, number[]>();
  for (const line of snapshot.trim().split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(ppid) || pid <= 1) continue;
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const result: number[] = [];
  const seen = new Set([parent]);
  const visit = (pid: number) => {
    for (const child of children.get(pid) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child); visit(child); result.push(child);
    }
  };
  visit(parent);
  return result;
}

const AGENTS: Record<string, string> = {
  claude: 'Claude', codex: 'Codex', gemini: 'Gemini', 'cursor-agent': 'Cursor', opencode: 'OpenCode',
  aider: 'Aider', amp: 'Amp', copilot: 'Copilot', goose: 'Goose', crush: 'Crush', pi: 'Pi',
};
const AGENT_PACKAGES: [string, string][] = [['/@anthropic-ai/claude-code/', 'Claude'], ['/@openai/codex/', 'Codex'], ['/@google/gemini-cli/', 'Gemini']];

/** Recognise coding agents from argv, including npm installs run as `node <script>`. */
export function agentName(command: string): string | undefined {
  const [program = '', ...args] = command.trim().split(/\s+/);
  const name = (path: string) => (path.split('/').pop() ?? '').replace(/\.[cm]?js$/, '');
  if (AGENTS[name(program)]) return AGENTS[name(program)];
  if (!/^(node|bun|deno|python[\d.]*)$/.test(name(program))) return undefined;
  const script = args.find(arg => !arg.startsWith('-'));
  if (!script) return undefined;
  return AGENTS[name(script)] ?? AGENT_PACKAGES.find(([path]) => script.includes(path))?.[1];
}

/** Find an agent running anywhere below the shell, so background and nested agents also count. */
export function agentOf(parent: number, snapshot: string): string | undefined {
  const commands = new Map(snapshot.trim().split('\n').map(line => {
    const [, pid, command] = /^\s*(\d+)\s+\d+\s+(.*)$/.exec(line) ?? [];
    return [Number(pid), command ?? ''] as const;
  }));
  for (const pid of descendantsOf(parent, snapshot)) {
    const agent = agentName(commands.get(pid) ?? '');
    if (agent) return agent;
  }
  return undefined;
}

/** One process snapshot serves every tab; undefined keeps the previous state on failure. */
export async function runningAgentsAsync(): Promise<((pid: number) => string | undefined) | undefined> {
  try {
    const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,ppid=,args='], {
      encoding: 'utf8', timeout: 1000, maxBuffer: 16 * 1024 * 1024,
    });
    return pid => agentOf(pid, stdout);
  } catch { return undefined; }
}

export function terminatePty(pty: PtyProcess): void {
  // Foreground programs can use a different process group and ignore SIGHUP.
  // Closing a tab ends its processes immediately, including during app quit.
  const options = { encoding: 'utf8' as const, timeout: 1000, maxBuffer: 4 * 1024 * 1024 };
  try {
    const snapshot = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,lstart='], options);
    const children = descendantsOf(pty.pid, snapshot);
    const identities = new Map(snapshot.trim().split('\n').map(line => {
      const [pid, , ...start] = line.trim().split(/\s+/);
      return [Number(pid), start.join(' ')] as const;
    }));
    if (children.length) {
      // Recheck identity immediately before signalling, without a timer that can
      // fire after a PID has been reused or after the application has quit.
      const current = execFileSync('/bin/ps', ['-p', children.join(','), '-o', 'pid=,lstart='], options);
      const live = new Map(current.trim().split('\n').map(line => {
        const [pid, ...start] = line.trim().split(/\s+/);
        return [Number(pid), start.join(' ')] as const;
      }));
      for (const pid of children) {
        if (!identities.get(pid) || live.get(pid) !== identities.get(pid)) continue;
        try { process.kill(pid, 'SIGKILL'); } catch { /* Child already exited. */ }
      }
    }
  } catch { /* PTY termination still works if process enumeration is unavailable. */ }
  try { pty.kill('SIGKILL'); } catch { /* Shell already exited. */ }
}
