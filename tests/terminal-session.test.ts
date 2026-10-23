import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalSession } from '../src/renderer/terminal-session.ts';
import type { TerminalAPI, TerminalEvent } from '../src/shared/terminal-protocol.ts';

function fixture(create: () => Promise<string> = async () => 'session-1') {
  const calls: unknown[][] = [];
  const writes: string[] = [];
  const processed: (() => void)[] = [];
  let receive: (event: TerminalEvent) => void = () => {};
  const api = {
    resize: (id: string, cols: number, rows: number) => calls.push(['resize', id, cols, rows]),
    create, ready: (id: string) => calls.push(['ready', id]),
    close: async (id: string) => { calls.push(['close', id]); },
    onEvent: (fn: typeof receive) => { receive = fn; return () => { receive = () => {}; }; },
    acknowledge: (id: string, sequence: number) => calls.push(['ack', id, sequence]),
  } as unknown as TerminalAPI;
  const session = new TerminalSession(api, {
    write: (data, callback) => { writes.push(data); processed.push(callback); },
    exited: message => calls.push(['exit', message]),
  });
  return { session, calls, writes, processed, receive: (event: TerminalEvent) => receive(event) };
}

test('acknowledges only after the terminal processes its own output', async () => {
  const f = fixture();
  await f.session.start({ cols: 80, rows: 24 });
  f.receive({ type: 'data', id: 'other', sequence: 1, data: 'wrong' });
  f.receive({ type: 'data', id: 'session-1', sequence: 2, data: 'hello' });
  assert.deepEqual(f.writes, ['hello']);
  assert.deepEqual(f.calls, [['ready', 'session-1']]);
  f.processed[0]();
  assert.deepEqual(f.calls[1], ['ack', 'session-1', 2]);
  await f.session.close();
  f.receive({ type: 'data', id: 'session-1', sequence: 3, data: 'late' });
  assert.deepEqual(f.writes, ['hello']);
});

test('closes a shell whose creation finishes after its tab was removed', async () => {
  let resolve!: (id: string) => void;
  const f = fixture(() => new Promise<string>(r => { resolve = r; }));
  const starting = f.session.start({ cols: 80, rows: 24 });
  await f.session.close();
  resolve('late-session');
  await starting;
  assert.deepEqual(f.calls, [['close', 'late-session']]);
});

test('shows natural exit status and stops acknowledging after closure', async () => {
  const f = fixture();
  await f.session.start({ cols: 80, rows: 24 });
  f.receive({ type: 'exit', id: 'session-1', exitCode: 7 });
  assert.match(String(f.calls[1][1]), /7/);
  f.receive({ type: 'data', id: 'session-1', sequence: 1, data: 'tail' });
  await f.session.close();
  f.processed[0]();
  assert.equal(f.calls.some(call => call[0] === 'ack'), false);
});

test('forwards a resize that occurs while shell creation is pending', async () => {
  let resolve!: (id: string) => void;
  const f = fixture(() => new Promise<string>(r => { resolve = r; }));
  const starting = f.session.start({ cols: 80, rows: 24 });
  f.session.resize(120, 40);
  resolve('session-1');
  await starting;
  assert.deepEqual(f.calls, [['resize', 'session-1', 120, 40], ['ready', 'session-1']]);
});
