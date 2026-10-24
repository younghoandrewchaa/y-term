import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { attachTerminalFileDrop, formatDroppedPaths } from '../src/renderer/file-drop.ts';

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

function dropFixture() {
  const host = new EventTarget();
  const calls: unknown[][] = [];
  let available = true;
  let resolvePath = (file: File) => `/tmp/${file.name}`;
  const cleanup = attachTerminalFileDrop(host as HTMLElement, {
    canPaste: () => available,
    getPathForFile: file => { calls.push(['resolve', file.name]); return resolvePath(file); },
    paste: text => { calls.push(['paste', text]); },
    focus: () => { calls.push(['focus']); },
    report: message => { calls.push(['report', message]); },
  });
  function dispatch(type: string, files: File[] = [], types = ['Files']) {
    const event = new Event(type, { cancelable: true, bubbles: true });
    const dataTransfer = { files, types, dropEffect: 'none' };
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    host.dispatchEvent(event);
    return { event, dataTransfer };
  }
  return { calls, cleanup, dispatch,
    setAvailable: (value: boolean) => { available = value; },
    setResolver: (value: typeof resolvePath) => { resolvePath = value; },
  };
}

test('accepts a protected file drag before the FileList becomes readable', () => {
  const f = dropFixture();
  const { event, dataTransfer } = f.dispatch('dragover');
  assert.equal(event.defaultPrevented, true);
  assert.equal(dataTransfer.dropEffect, 'copy');
  assert.deepEqual(f.calls, []);
});

test('drops one ordered batch of file and folder paths and focuses once', () => {
  const f = dropFixture();
  const { event } = f.dispatch('drop', [new File([], 'file.txt'), new File([], 'a folder')]);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(f.calls, [
    ['resolve', 'file.txt'], ['resolve', 'a folder'],
    ['paste', "'/tmp/file.txt' '/tmp/a folder' "], ['focus'],
  ]);
});

test('does not intercept ordinary text drags', () => {
  const f = dropFixture();
  for (const type of ['dragover', 'drop']) assert.equal(f.dispatch(type, [], ['text/plain']).event.defaultPrevented, false);
  assert.deepEqual(f.calls, []);
});

test('unavailable sessions block file drops without resolving or queuing input', () => {
  const f = dropFixture();
  f.setAvailable(false);
  assert.equal(f.dispatch('dragover').dataTransfer.dropEffect, 'none');
  assert.equal(f.dispatch('drop', [new File([], 'file')]).event.defaultPrevented, true);
  f.setAvailable(true);
  assert.deepEqual(f.calls, []);
});

test('rejects the whole batch when native path resolution fails or returns an invalid path', () => {
  for (const invalid of ['', 'relative', '/tmp/new\nline']) {
    const f = dropFixture();
    f.setResolver(file => file.name === 'bad' ? invalid : '/tmp/good');
    f.dispatch('drop', [new File([], 'good'), new File([], 'bad')]);
    assert.deepEqual(f.calls.map(call => call[0]), ['resolve', 'resolve', 'report']);
  }
  const f = dropFixture();
  f.setResolver(() => { throw new Error('Not a native file'); });
  assert.doesNotThrow(() => f.dispatch('drop', [new File([], 'bad')]));
  assert.deepEqual(f.calls.map(call => call[0]), ['resolve', 'report']);
});

test('checks availability again after resolution and ignores empty selections', () => {
  const f = dropFixture();
  f.dispatch('drop');
  assert.deepEqual(f.calls, []);
  f.setResolver(() => { f.setAvailable(false); return '/tmp/file'; });
  f.dispatch('drop', [new File([], 'file')]);
  assert.deepEqual(f.calls, [['resolve', 'file']]);
});

test('removes drop listeners when the terminal closes', () => {
  const f = dropFixture();
  f.cleanup();
  f.cleanup();
  assert.equal(f.dispatch('dragover').event.defaultPrevented, false);
  assert.equal(f.dispatch('drop', [new File([], 'file')]).event.defaultPrevented, false);
  assert.deepEqual(f.calls, []);
});
