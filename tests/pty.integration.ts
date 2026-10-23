import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node-pty';
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
