import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../src/main/session-manager.ts';
import type { PtyProcess, TerminalEvent } from '../src/shared/terminal-protocol.ts';

test('Git directory reads require an owned live session and never fall back to a cached directory', () => {
  const pty = new FakePty();
  let cwd: string | undefined = '/first';
  const manager = new SessionManager(() => pty, () => {}, () => {}, () => cwd);
  const id = manager.create(1, { cols: 80, rows: 24 });
  assert.equal(manager.directoryFor(1, id), '/first');
  cwd = '/after-cd';
  assert.equal(manager.directoryFor(1, id), '/after-cd');
  cwd = undefined;
  assert.equal(manager.directoryFor(1, id), undefined);
  assert.throws(() => manager.directoryFor(2, id), /session/i);
  pty.exit({ exitCode: 0 }); cwd = '/reused-pid';
  assert.throws(() => manager.directoryFor(1, id), /exited/i);
  manager.close(1, id);
  assert.throws(() => manager.directoryFor(1, id), /session/i);
});

test('file links use the owned session live directory and retain it after exit', async () => {
  const pty = new FakePty();
  let cwd: string | undefined = '/first';
  const events: TerminalEvent[] = [];
  const manager = new SessionManager(() => pty, (_owner, event) => events.push(event), () => {}, () => cwd);
  const id = manager.create(1, { cols: 80, rows: 24 });
  manager.ready(1, id);
  assert.equal(manager.directory(1, id), '/first');
  cwd = '/after-cd';
  assert.equal(manager.directory(1, id), '/after-cd');
  assert.deepEqual(events, [{ type: 'directory', id, cwd: '/first' }, { type: 'directory', id, cwd: '/after-cd' }]);
  assert.throws(() => manager.directory(2, id), /session/i);
  pty.exit({ exitCode: 0 });
  cwd = '/reused-pid';
  assert.equal(manager.directory(1, id), '/after-cd');
  manager.close(1, id);
  assert.throws(() => manager.directory(1, id), /session/i);
});

class FakePty implements PtyProcess {
  pid = 123;
  writes: (string | Buffer)[] = [];
  sizes: number[][] = [];
  paused = false;
  killed = false;
  data: (data: string) => void = () => {};
  exit: (event: { exitCode: number; signal?: number }) => void = () => {};
  onData(fn: typeof this.data) { this.data = fn; return { dispose() {} }; }
  onExit(fn: typeof this.exit) { this.exit = fn; return { dispose() {} }; }
  write(data: string | Buffer) { this.writes.push(data); }
  resize(cols: number, rows: number) { this.sizes.push([cols, rows]); }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  kill() { this.killed = true; }
}

function setup() {
  const ptys: FakePty[] = [];
  const events: TerminalEvent[] = [];
  const manager = new SessionManager(() => {
    const pty = new FakePty(); ptys.push(pty); return pty;
  }, (_owner, event) => events.push(event), (pty) => pty.kill());
  return { manager, ptys, events };
}

test('reports directory changes for each live tab and retains the last directory on lookup failure', async () => {
  const { manager, ptys, events } = setup();
  const first = manager.create(1, { cols: 80, rows: 24 });
  const second = manager.create(2, { cols: 80, rows: 24 });
  manager.ready(1, first); manager.ready(2, second);
  ptys[1].pid = 456;
  await manager.refreshDirectories(async pid => pid === 123 ? '/work/project' : '/other/folder');
  assert.deepEqual(events, [
    { type: 'directory', id: first, cwd: '/work/project' },
    { type: 'directory', id: second, cwd: '/other/folder' },
  ]);
  await manager.refreshDirectories(async pid => pid === 123 ? '/work/project' : '/other/folder');
  assert.equal(events.length, 2, 'unchanged directories do not emit duplicate events');
  await manager.refreshDirectories(async () => undefined);
  assert.equal(events.length, 2);
  manager.close(1, first);
  ptys[1].exit({ exitCode: 0 });
  events.length = 0;
  await manager.refreshDirectories(async () => '/late');
  assert.deepEqual(events, []);
});

test('does not deliver a directory lookup that finishes after tab closure', async () => {
  const { manager, events } = setup();
  const id = manager.create(1, { cols: 80, rows: 24 });
  manager.ready(1, id);
  let resolve!: (cwd: string) => void;
  const refreshing = manager.refreshDirectories(() => new Promise<string>(done => { resolve = done; }));
  manager.close(1, id);
  resolve('/late');
  await refreshing;
  assert.deepEqual(events, []);
});

test('buffers startup output until the renderer is ready', () => {
  const { manager, ptys, events } = setup();
  const id = manager.create(1, { cols: 80, rows: 24 });
  ptys[0].data('early prompt');
  assert.equal(events.length, 0);
  manager.ready(1, id);
  assert.deepEqual(events, [{ type: 'data', id, sequence: 1, data: 'early prompt' }]);
});

test('rejects input, resize, acknowledgements and closure from another window', () => {
  const { manager, ptys } = setup();
  const id = manager.create(1, { cols: 80, rows: 24 });
  for (const attempt of [
    () => manager.write(2, id, 'secret', false),
    () => manager.resize(2, id, 10, 10),
    () => manager.ack(2, id, 1),
    () => manager.close(2, id),
  ]) assert.throws(attempt, /session/i);
  assert.deepEqual(ptys[0].writes, []);
  assert.equal(ptys[0].killed, false);
});

test('validates dimensions and routes writes only to the chosen PTY', () => {
  const { manager, ptys } = setup();
  assert.throws(() => manager.create(1, { cols: 0, rows: 24 }), /dimensions/i);
  const first = manager.create(1, { cols: 80, rows: 24 });
  const second = manager.create(1, { cols: 80, rows: 24 });
  manager.write(1, second, 'ls\r', false);
  manager.write(1, first, '\x80', true);
  manager.resize(1, second, 120, 40);
  assert.deepEqual(ptys[0].writes, [Buffer.from([0x80])]);
  assert.deepEqual(ptys[1].writes, ['ls\r']);
  assert.deepEqual(ptys[1].sizes, [[120, 40]]);
  assert.throws(() => manager.resize(1, first, 1.5, 40), /dimensions/i);
  assert.throws(() => manager.write(1, first, 'a'.repeat(262145), false), /input/i);
});

test('pauses output until actual outstanding chunks are acknowledged once', () => {
  const { manager, ptys } = setup();
  const id = manager.create(1, { cols: 80, rows: 24 });
  manager.ready(1, id);
  ptys[0].data('a'.repeat(100_000));
  ptys[0].data('b'.repeat(100_000));
  assert.equal(ptys[0].paused, true);
  manager.ack(1, id, 999);
  manager.ack(1, id, 1);
  manager.ack(1, id, 1);
  assert.equal(ptys[0].paused, true);
  manager.ack(1, id, 2);
  assert.equal(ptys[0].paused, false);
});

test('caps startup buffering if a producer ignores backpressure', () => {
  const { manager, ptys, events } = setup();
  const id = manager.create(1, { cols: 80, rows: 24 });
  for (let n = 0; n < 20; n++) ptys[0].data('x'.repeat(100_000));
  assert.equal(ptys[0].killed, true);
  manager.ready(1, id);
  assert.equal(events.filter(e => e.type === 'exit').length, 1);
});

test('delivers a fast shell exit after queued startup output', () => {
  const { manager, ptys, events } = setup();
  const id = manager.create(1, { cols: 80, rows: 24 });
  ptys[0].data('bye'); ptys[0].exit({ exitCode: 7 });
  manager.ready(1, id);
  assert.equal(events[0].type, 'data');
  assert.deepEqual(events[1], { type: 'exit', id, exitCode: 7 });
  assert.throws(() => manager.write(1, id, 'ls\r', false), /exited/i);
});

test('cleans up only the closing owner and makes repeated closure harmless', () => {
  const { manager, ptys } = setup();
  const first = manager.create(1, { cols: 80, rows: 24 });
  manager.create(2, { cols: 80, rows: 24 });
  manager.closeOwner(1);
  manager.close(1, first);
  assert.equal(ptys[0].killed, true);
  assert.equal(ptys[1].killed, false);
  assert.throws(() => manager.write(1, first, 'x', false), /session/i);
});

test('reports PTY startup failures without retaining a broken session', () => {
  const manager = new SessionManager(() => { throw new Error('shell missing'); }, () => {}, () => {});
  assert.throws(() => manager.create(1, { cols: 80, rows: 24 }), /shell missing/);
});

test('inherits the live directory of the selected session and enforces window ownership', () => {
  const directories: (string | undefined)[] = [];
  const ptys: FakePty[] = [];
  let cwd: string | undefined = '/private/tmp/first';
  const manager = new SessionManager((_size, directory) => {
    directories.push(directory);
    const pty = new FakePty(); pty.pid = 100 + ptys.length; ptys.push(pty); return pty;
  }, () => {}, () => {}, pid => { assert.equal(pid, 100); return cwd; });
  const first = manager.create(1, { cols: 80, rows: 24 });
  manager.create(1, { cols: 80, rows: 24 }, first);
  cwd = '/private/tmp/after-cd';
  manager.create(1, { cols: 80, rows: 24 }, first);
  assert.throws(() => manager.create(2, { cols: 80, rows: 24 }, first), /session/i);
  cwd = undefined;
  manager.create(1, { cols: 80, rows: 24 }, first);
  ptys[0].exit({ exitCode: 0 });
  manager.create(1, { cols: 80, rows: 24 }, first);
  assert.deepEqual(directories, [undefined, '/private/tmp/first', '/private/tmp/after-cd', undefined, undefined]);
});

test('reports agents starting and stopping and keeps state when the process snapshot fails', async () => {
  const { manager, ptys, events } = setup();
  const id = manager.create(1, { cols: 80, rows: 24 });
  manager.ready(1, id);
  await manager.refreshAgents(async () => pid => pid === 123 ? 'Claude' : undefined);
  await manager.refreshAgents(async () => () => 'Claude');
  await manager.refreshAgents(async () => undefined);
  assert.deepEqual(events, [{ type: 'agent', id, agent: 'Claude' }], 'unchanged or unknown state emits nothing');
  await manager.refreshAgents(async () => () => undefined);
  assert.deepEqual(events.at(-1), { type: 'agent', id });
  await manager.refreshAgents(async () => () => 'Codex');
  ptys[0].exit({ exitCode: 0 });
  events.length = 0;
  await manager.refreshAgents(async () => () => 'Codex');
  assert.deepEqual(events, [{ type: 'agent', id }], 'an exited shell clears its agent');
});
