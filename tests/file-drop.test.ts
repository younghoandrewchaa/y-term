import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { formatDroppedPaths } from '../src/renderer/file-drop.ts';

test('formats file and folder paths in selection order with a trailing space', () => {
  assert.equal(formatDroppedPaths([]), '');
  assert.equal(formatDroppedPaths(['/tmp/a']), "'/tmp/a' ");
  assert.equal(formatDroppedPaths(['/tmp/a', '/tmp/a folder']), "'/tmp/a' '/tmp/a folder' ");
  assert.equal(formatDroppedPaths(["/tmp/it's"]), "'/tmp/it'\\''s' ");
});

for (const shell of ['/bin/zsh', '/bin/bash']) {
  test(`preserves special characters as literal arguments in ${shell}`, () => {
    const paths = ['/tmp/hello world', "/tmp/it's", '/tmp/한글😀', '/tmp/\\backslash',
      '/tmp/$(echo injected)', '/tmp/`echo injected`', '/tmp/;echo injected', '/tmp/*?[a]"$HOME'];
    const result = execFileSync(shell, ['-f', '-c', `printf '%s\\0' ${formatDroppedPaths(paths)}`]);
    assert.deepEqual(result.toString().split('\0'), [...paths, '']);
  });
}

test('rejects an entire selection when any native path is missing, relative, or contains controls', () => {
  for (const path of ['', 'relative', 'file:///tmp/a', ...Array.from({ length: 32 }, (_, n) => `/tmp/a${String.fromCharCode(n)}b`), '/tmp/a\x7fb']) {
    assert.throws(() => formatDroppedPaths(['/tmp/valid', path]), /path|control/i);
  }
});
