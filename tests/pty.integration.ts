import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node-pty';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../src/main/session-manager.ts';

for (const [shell, args] of [
  ['/bin/zsh', ['-f', '-i']],
  ['/bin/bash', ['--noprofile', '--norc', '-i']],
] as const) {
  test(`real ${shell} processes Unicode, resize, and sustained output through session transport`, async () => {
    let output = '';
    const manager = new SessionManager(size => spawn(shell, [...args], {
      ...size, cwd: '/private/tmp', name: 'xterm-256color',
      env: { PATH: '/usr/bin:/bin', HOME: '/private/tmp', TERM: 'xterm-256color', LC_ALL: 'en_US.UTF-8' },
    }), (owner, event) => {
      if (event.type === 'data') { output += event.data; manager.ack(owner, event.id, event.sequence); }
    }, pty => pty.kill('SIGKILL'));
    const id = manager.create(1, { cols: 80, rows: 24 });
    async function until(expected: RegExp): Promise<void> {
      const deadline = Date.now() + 8000;
      while (!expected.test(output) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      assert.match(output, expected);
    }
    try {
      manager.ready(1, id);
      manager.write(1, id, "printf 'YTERM_%s:%s\\n' 'NATIVE' '你好 🐚'\r", false);
      await until(/YTERM_NATIVE:你好 🐚/);
      manager.resize(1, id, 101, 37);
      manager.write(1, id, "printf 'YTERM_SIZE:'; stty size\r", false);
      await until(/YTERM_SIZE:37\s+101/);
      manager.write(1, id, "seq 1 50000; printf 'YTERM_%s\\n' 'FLOOD_DONE'\r", false);
      await until(/50000[\r\n]+YTERM_FLOOD_DONE/);
    } finally { manager.close(1, id); }
    assert.throws(() => manager.write(1, id, 'x', false), /session/i);
  });
}

const repo = join(import.meta.dirname, '..');
const ESC = '\x1b]';
const BEL = '\x07';

async function zshIntegration(extraEnv: (home: string) => Record<string, string> = () => ({}), rcDir = (home: string) => home, files: { zshrc?: string; zshenv?: string } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'yterm-zsh-'));
  mkdirSync(rcDir(home), { recursive: true });
  writeFileSync(join(rcDir(home), '.zshrc'), `print YTERM_RC_LOADED\n${files.zshrc ?? ''}`);
  writeFileSync(join(home, '.zshenv'), `export YTERM_ENV_LOADED=1\n${files.zshenv ?? ''}`);
  let output = '';
  const manager = new SessionManager(size => spawn('/bin/zsh', ['-l', '-i'], {
    ...size, cwd: home, name: 'xterm-256color',
    env: {
      PATH: '/usr/bin:/bin', HOME: home, TERM: 'xterm-256color', LC_ALL: 'en_US.UTF-8',
      ZDOTDIR: join(repo, 'src/shell-integration/zsh'), Y_TERM_SHELL_INTEGRATION_NONCE: 'n0nce', ...extraEnv(home),
    },
  }), (owner, event) => {
    if (event.type === 'data') { output += event.data; manager.ack(owner, event.id, event.sequence); }
  }, pty => pty.kill('SIGKILL'));
  const id = manager.create(1, { cols: 80, rows: 24 });
  manager.ready(1, id);
  return {
    home,
    get output() { return output; },
    write: (data: string) => manager.write(1, id, data, false),
    async until(expected: RegExp): Promise<void> {
      const deadline = Date.now() + 8000;
      while (!expected.test(output) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      assert.match(output, expected);
    },
    close() { manager.close(1, id); rmSync(home, { recursive: true, force: true }); },
  };
}

test('zsh integration loads the user\'s startup files and hides the nonce', async () => {
  const z = await zshIntegration();
  try {
    await z.until(/YTERM_RC_LOADED/);
    z.write('print -r -- "ENV=$YTERM_ENV_LOADED ZD=${ZDOTDIR-unset} NONCE=${Y_TERM_SHELL_INTEGRATION_NONCE-unset}"\r');
    await z.until(/ENV=1 ZD=unset NONCE=unset/);
  } finally { z.close(); }
});

test('zsh integration restores an inherited ZDOTDIR', async () => {
  const z = await zshIntegration(home => ({ Y_TERM_USER_ZDOTDIR: join(home, 'zdot') }), home => join(home, 'zdot'));
  try {
    await z.until(/YTERM_RC_LOADED/);
    z.write('print -r -- "ZD=$ZDOTDIR"\r');
    await z.until(new RegExp(`ZD=${join(z.home, 'zdot')}\\r?\\n`));
  } finally { z.close(); }
});

test('zsh integration reports prompts, command lines and exit codes', async () => {
  const z = await zshIntegration();
  try {
    await z.until(new RegExp(`${ESC}133;A${BEL}[^]*${ESC}133;B${BEL}`));
    z.write('false\r');
    await z.until(new RegExp(`${ESC}133;A${BEL}[^]*${ESC}633;E;false;n0nce${BEL}${ESC}133;C${BEL}[^]*${ESC}133;D;1${BEL}${ESC}133;A${BEL}[^]*${ESC}133;B${BEL}`));
  } finally { z.close(); }
});

test('zsh integration escapes command lines', async () => {
  const z = await zshIntegration();
  try {
    await z.until(new RegExp(`${ESC}133;B${BEL}`));
    z.write("print -r -- 'a;b\\c' 你好\r");
    await z.until(new RegExp(`${ESC}633;E;print -r -- 'a\\\\x3bb\\\\\\\\c' 你好;n0nce${BEL}`));
  } finally { z.close(); }
});

test('zsh integration emits no D for an empty command line', async () => {
  const z = await zshIntegration();
  try {
    await z.until(new RegExp(`${ESC}133;B${BEL}`));
    z.write('\r');
    await z.until(new RegExp(`${ESC}133;A${BEL}[^]*${ESC}133;A${BEL}`));
    z.write('print -r -- AFTER_EMPTY\r');
    await z.until(/AFTER_EMPTY\r?\n/);
    const first = z.output.indexOf(`${ESC}133;A${BEL}`);
    const between = z.output.slice(first + `${ESC}133;A${BEL}`.length, z.output.indexOf('AFTER_EMPTY'));
    assert.equal(between.split(`${ESC}133;A${BEL}`).length - 1, 1);
    assert.doesNotMatch(between, /133;D/);
  } finally { z.close(); }
});

test('zsh integration escapes control characters in lowercase hex', async () => {
  const z = await zshIntegration();
  try {
    await z.until(new RegExp(`${ESC}133;B${BEL}`));
    z.write(': a\x16\tb\r');
    await z.until(new RegExp(`${ESC}633;E;: a\\\\x09b;n0nce${BEL}`));
    assert.doesNotMatch(z.output, /\\x[0-9a-f]*[A-F]/);
  } finally { z.close(); }
});

test('zsh integration escapes a long command line quickly', async () => {
  const z = await zshIntegration();
  try {
    await z.until(new RegExp(`${ESC}133;B${BEL}`));
    const start = Date.now();
    z.write(`\x1b[200~: ${'x'.repeat(40000)}\x1b[201~\r`);
    await z.until(new RegExp(`${ESC}633;E;: x{40000};n0nce${BEL}`));
    assert.ok(Date.now() - start < 2000, `took ${Date.now() - start} ms`);
  } finally { z.close(); }
});

test('zsh integration keeps the nonce from the user\'s .zshenv children', async () => {
  const z = await zshIntegration(undefined, undefined, { zshenv: 'print -r -- "CHILD_SAW=$(env | grep -c Y_TERM_SHELL_INTEGRATION_NONCE)"\n' });
  try {
    await z.until(/CHILD_SAW=0/);
    await z.until(new RegExp(`${ESC}133;B${BEL}`));
    z.write('true\r');
    await z.until(new RegExp(`${ESC}633;E;true;n0nce${BEL}`));
  } finally { z.close(); }
});

test('zsh integration marks the first prompt even when a precmd hook rebuilds PS1', async () => {
  const z = await zshIntegration(undefined, undefined, { zshrc: "_fw() { PS1='FW> ' }\nprecmd_functions+=(_fw)\n" });
  try {
    await z.until(new RegExp(`FW> [^]*${ESC}133;B${BEL}`));
    const before = z.output.slice(0, z.output.indexOf(`${ESC}133;B${BEL}`));
    assert.equal(before.split(`${ESC}133;A${BEL}`).length - 1, 1);
  } finally { z.close(); }
});
