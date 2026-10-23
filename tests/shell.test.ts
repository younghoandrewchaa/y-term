import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShellLaunch, descendantsOf } from '../src/main/shell.ts';
import { defaultPreferences } from '../src/main/preferences.ts';

test('starts the configured login shell at home with a terminal environment', () => {
  const launch = buildShellLaunch({ ...defaultPreferences(), shell: '/bin/zsh', cwd: '/private/tmp' }, { cols: 90, rows: 30 }, {
    PATH: '/usr/bin:/bin', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect', HELLO: 'world',
  });
  assert.equal(launch.file, '/bin/zsh');
  assert.deepEqual(launch.args, ['-l', '-i']);
  assert.equal(launch.options.cwd, '/private/tmp');
  assert.equal(launch.options.env.TERM, 'xterm-256color');
  assert.equal(launch.options.env.COLORTERM, 'truecolor');
  assert.equal(launch.options.env.HELLO, 'world');
  assert.equal(launch.options.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(launch.options.env.NODE_OPTIONS, undefined);
});

test('rejects a missing shell or a file used as the starting directory', () => {
  assert.throws(() => buildShellLaunch({ ...defaultPreferences(), shell: '/does/not/exist' }, { cols: 80, rows: 24 }, {}), /shell/i);
  assert.throws(() => buildShellLaunch({ ...defaultPreferences(), cwd: '/bin/sh' }, { cols: 80, rows: 24 }, {}), /directory/i);
});

test('selects descendants for cleanup without including unrelated processes', () => {
  assert.deepEqual(descendantsOf(10, '10 1\n11 10\n12 11\n13 1\n14 10\n'), [12, 11, 14]);
});

test('forcefully ends owned children before the shell, skipping reused process IDs', async () => {
  const childProcess = await import('node:child_process');
  const { syncBuiltinESMExports } = await import('node:module');
  const { mock } = await import('node:test');
  const { terminatePty } = await import('../src/main/shell.ts');
  const killed: unknown[][] = [];
  const exec = mock.method(childProcess.default, 'execFileSync', (_file: string, args: string[]) => {
    if (args[0] === '-axo') return '10 1 Mon Oct 12 10:00:00 2026\n11 10 Mon Oct 12 10:01:00 2026\n12 10 Mon Oct 12 10:02:00 2026\n';
    return '11 Mon Oct 12 10:01:00 2026\n12 Mon Oct 12 11:00:00 2026\n';
  });
  const kill = mock.method(process, 'kill', (pid: number, signal: string) => { killed.push([pid, signal]); return true; });
  syncBuiltinESMExports();
  try {
    terminatePty({ pid: 10, kill: (signal?: string) => { killed.push(['shell', signal]); } } as import('../src/shared/terminal-protocol.ts').PtyProcess);
    assert.deepEqual(killed, [[11, 'SIGKILL'], ['shell', 'SIGKILL']]);
  } finally { exec.mock.restore(); kill.mock.restore(); syncBuiltinESMExports(); }
});
