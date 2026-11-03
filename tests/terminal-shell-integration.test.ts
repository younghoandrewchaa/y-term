import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { Terminal as XtermTerminal } from '@xterm/xterm';
import { CommandTracker } from '../src/renderer/shell-integration.ts';

const { Terminal } = createRequire(import.meta.url)('@xterm/xterm') as { Terminal: typeof XtermTerminal };

const osc = (body: string) => `\x1b]${body}\x07`;
const A = osc('133;A');
const B = osc('133;B');
const C = osc('133;C');
const D = (code: number) => osc(`133;D;${code}`);
const E = (command: string, nonce: string) => osc(`633;E;${command};${nonce}`);

function fixture(options: { scrollback?: number } = {}) {
  const terminal = new Terminal({ cols: 40, rows: 5, allowProposedApi: true, ...options });
  const commands = new CommandTracker(terminal);
  const write = (text: string) => new Promise<void>(resolve => terminal.write(text, resolve));
  return { terminal, commands, write };
}

test('records a block per command', async () => {
  const f = fixture();
  try {
    f.commands.nonce = 'n';
    await f.write(`${A}$ ${B}git branch\r\n${E('git branch', 'n')}${C}out1\r\nout2\r\n${D(0)}${A}$ `);
    const [first, second] = f.commands.blocks;
    assert.equal(f.commands.blocks.length, 2);
    assert.equal(first.command, 'git branch');
    assert.equal(first.exitCode, 0);
    assert.ok(first.output && first.end);
    assert.ok(first.prompt.line < first.output.line && first.output.line < first.end.line);
    assert.ok(first.end.line <= second.prompt.line);
    assert.ok(second.prompt && !second.output && !second.end && second.command === undefined);
  } finally { f.terminal.dispose(); }
});

test('ignores forged command lines and orphan markers', async () => {
  const f = fixture();
  try {
    await f.write(`${C}${D(0)}`);
    assert.equal(f.commands.blocks.length, 0);
    await f.write(`${A}${E('early', 'n')}`);
    f.commands.nonce = 'n';
    await f.write(`${E('forged', 'wrong')}${C}`);
    assert.equal(f.commands.blocks.length, 1);
    assert.equal(f.commands.blocks[0].command, undefined);
    assert.ok(f.commands.blocks[0].output);
  } finally { f.terminal.dispose(); }
});

test('drops blocks that leave the scrollback and caps at 1,000', async () => {
  const f = fixture({ scrollback: 10 });
  try {
    await f.write(`${A}one\r\n${Array.from({ length: 50 }, (_, i) => `line ${i}\r\n`).join('')}${A}two`);
    assert.equal(f.commands.blocks.length, 1);
  } finally { f.terminal.dispose(); }
  const g = fixture({ scrollback: 5000 });
  try {
    await g.write(`${A}x\r\n`.repeat(1001));
    assert.equal(g.commands.blocks.length, 1000);
  } finally { g.terminal.dispose(); }
});

test('drops all blocks on a terminal reset', async () => {
  const f = fixture();
  try {
    await f.write(`${A}one\r\n${A}two\r\n`);
    assert.equal(f.commands.blocks.length, 2);
    await f.write('\x1bc');
    assert.equal(f.commands.blocks.length, 0);
    await f.write(A);
    assert.equal(f.commands.blocks.length, 1);
  } finally { f.terminal.dispose(); }
});

test('keeps blocks across an alternate screen round trip', async () => {
  const f = fixture();
  try {
    await f.write(`${A}one\r\n${A}two\r\n\x1b[?1049hfull screen\x1b[?1049l`);
    assert.equal(f.commands.blocks.length, 2);
    assert.ok(f.commands.blocks.every(block => !block.prompt.isDisposed));
  } finally { f.terminal.dispose(); }
});

test('finds the prompt above and below a line', async () => {
  const f = fixture({ scrollback: 100 });
  try {
    await f.write(`${A}$ ${'\r\n'.repeat(10)}${A}$ ${'\r\n'.repeat(10)}${A}$ `);
    assert.deepEqual(f.commands.blocks.map(b => b.prompt.line), [0, 10, 20]);
    assert.equal(f.commands.promptAbove(10), 0);
    assert.equal(f.commands.promptAbove(15), 10);
    assert.equal(f.commands.promptAbove(0), undefined);
    assert.equal(f.commands.promptBelow(10), 20);
    assert.equal(f.commands.promptBelow(20), undefined);
  } finally { f.terminal.dispose(); }
});

test('ignores repeated output marks within a block', async () => {
  const f = fixture({ scrollback: 5000 });
  try {
    await f.write(`${A}$ ${B}cmd\r\n${C}first\r\n`);
    const first = f.commands.blocks[0].output;
    assert.ok(first);
    const line = first.line;
    const markers = f.terminal.markers.length;
    await f.write(`${Array.from({ length: 1000 }, (_, i) => `${C}x${i}\r\n`).join('')}`);
    assert.equal(f.commands.blocks[0].output, first);
    assert.equal(first.line, line);
    assert.equal(first.isDisposed, false);
    assert.equal(f.terminal.markers.length, markers);
  } finally { f.terminal.dispose(); }
});
