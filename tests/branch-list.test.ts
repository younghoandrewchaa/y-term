import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { Terminal as XtermTerminal } from '@xterm/xterm';
import { isBranchListCommand, parseBranchLine } from '../src/shared/branch-list.ts';
import { branchLines } from '../src/renderer/branch-actions.ts';
import { CommandTracker } from '../src/renderer/shell-integration.ts';
import type { CommandBlock } from '../src/renderer/shell-integration.ts';

const { Terminal } = createRequire(import.meta.url)('@xterm/xterm') as { Terminal: typeof XtermTerminal };
const osc = (body: string) => `\x1b]${body}\x07`;

test('recognises commands that print a plain branch list', () => {
  for (const command of ['git branch', '  git  branch ', 'git --no-pager branch', 'git branch --list', 'git branch --merged', 'git branch --no-merged main']) {
    assert.equal(isBranchListCommand(command), true, command);
  }
  for (const command of [undefined, '', 'git branch -a', 'git branch -r', 'git branch -v', 'git branch -d old', 'git branch new',
    'git branch --merged main extra', 'git branch --merged -v', 'cd x && git branch', 'git branch; rm -rf x', 'gitbranch', 'echo git branch']) {
    assert.equal(isBranchListCommand(command), false, String(command));
  }
});

test('parses only branches that are not checked out', () => {
  assert.equal(parseBranchLine('  feature/one'), 'feature/one');
  assert.equal(parseBranchLine('  fix-ü  '), 'fix-ü');
  assert.equal(parseBranchLine('* main'), undefined);
  assert.equal(parseBranchLine('+ worktree-branch'), undefined);
  assert.equal(parseBranchLine('* (HEAD detached at 1234567)'), undefined);
  assert.equal(parseBranchLine('  (no branch)'), undefined);
  assert.equal(parseBranchLine('  two words'), undefined);
  assert.equal(parseBranchLine('main'), undefined);
  assert.equal(parseBranchLine(''), undefined);
});

async function run(command: string, output: string, exitCode = 0, cols = 40) {
  const terminal = new Terminal({ cols, rows: 10, allowProposedApi: true });
  const commands = new CommandTracker(terminal);
  commands.nonce = 'n';
  const finished: CommandBlock[] = [];
  commands.finished = block => finished.push(block);
  await new Promise<void>(resolve => terminal.write(
    `${osc('133;A')}$ ${osc('133;B')}${command}\r\n${osc(`633;E;${command};n`)}${osc('133;C')}${output}${osc(`133;D;${exitCode}`)}${osc('133;A')}$ `, resolve));
  return { terminal, finished };
}

test('finds branch lines in a finished git branch block', async () => {
  const { terminal, finished } = await run('git branch', '  feature\r\n* \x1b[32mmain\x1b[m\r\n+ linked\r\n  日本\r\n');
  try {
    assert.equal(finished.length, 1);
    const lines = branchLines(terminal, finished[0]);
    const start = finished[0].output!.line;
    assert.deepEqual(lines, [{ line: start, name: 'feature', end: 9 }, { line: start + 3, name: '日本', end: 6 }]);
  } finally { terminal.dispose(); }
});

test('ignores other commands, failures and wrapped names', async () => {
  for (const [command, output, code] of [['git branch -a', '  feature\r\n', 0], ['git branch', '  feature\r\n', 1], ['cat list', '  feature\r\n', 0]] as const) {
    const { terminal, finished } = await run(command, output, code);
    try { assert.deepEqual(branchLines(terminal, finished[0]), [], command); } finally { terminal.dispose(); }
  }
  const { terminal, finished } = await run('git branch', `  ${'x'.repeat(30)}\r\n  ok\r\n`, 0, 20);
  try { assert.deepEqual(branchLines(terminal, finished[0]).map(line => line.name), ['ok']); } finally { terminal.dispose(); }
});
