import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findCode, VsCodeDiff } from '../src/main/vscode-diff.ts';

async function directory(t: test.TestContext) {
  const path = await mkdtemp(join(tmpdir(), 'y-term-vscode-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('finds code on PATH before the usual install locations', async t => {
  const root = await directory(t);
  const code = join(root, 'code');
  await writeFile(code, '#!/bin/sh\n', { mode: 0o755 });
  assert.equal(await findCode(`/does-not-exist:${root}`, ['/also-missing/code']), code);
  assert.equal(await findCode('/does-not-exist', [code]), code);
  assert.equal(await findCode('/does-not-exist', ['/also-missing/code']), undefined);
});

test('opens a read-only previous version beside the working file and removes it on dispose', async t => {
  const root = await directory(t);
  const log = join(root, 'args');
  const code = join(root, 'code');
  await writeFile(code, `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\n`, { mode: 0o755 });
  const file = join(root, 'index.ts');
  await writeFile(file, 'new\n');
  const diff = new VsCodeDiff({ root, find: async () => code });
  assert.equal(await diff.open(file, 'HEAD', Buffer.from('old\n')), true);
  let args: string[] = [];
  for (let i = 0; i < 100 && !args.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    args = (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  }
  assert.equal(args.length, 3);
  assert.equal(args[0], '--diff');
  assert.match(args[1], /\/index \(HEAD\)\.ts$/);
  assert.equal(args[2], file);
  assert.equal(await readFile(args[1], 'utf8'), 'old\n');
  assert.equal((await stat(args[1])).mode & 0o222, 0);
  diff.dispose();
  await assert.rejects(access(args[1]));
});

test('reports that VS Code is unavailable so the caller can open the file instead', async t => {
  const root = await directory(t);
  const diff = new VsCodeDiff({ root, find: async () => undefined });
  assert.equal(await diff.open(join(root, 'file'), 'HEAD', Buffer.from('old')), false);
});
