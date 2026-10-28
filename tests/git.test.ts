import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitService, parseGitStatus } from '../src/main/git.ts';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'y-term-git-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 'test@example.invalid'); git(root, 'config', 'user.name', 'Test');
  return root;
}
const service = new GitService();
const text = async (root: string, path: string) => {
  const result = await service.baseline(1, join(root, path));
  return result && { label: result.label, content: result.content.toString('utf8') };
};

test('compares unstaged changes with the index and staged-only changes with HEAD', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'nested'));
  for (const path of ['file.ts', 'nested/staged.ts', 'clean.ts']) await writeFile(join(root, path), `original ${path}\n`);
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'base');
  assert.equal(await text(root, 'clean.ts'), undefined);
  await writeFile(join(root, 'file.ts'), 'working\n');
  assert.deepEqual(await text(root, 'file.ts'), { label: 'HEAD', content: 'original file.ts\n' });
  await writeFile(join(root, 'file.ts'), 'staged\n'); git(root, 'add', '.');
  await writeFile(join(root, 'file.ts'), 'working\n');
  assert.deepEqual(await text(root, 'file.ts'), { label: 'Staged', content: 'staged\n' });
  await writeFile(join(root, 'nested/staged.ts'), 'staged only\n'); git(root, 'add', '.');
  assert.deepEqual(await text(root, 'nested/staged.ts'), { label: 'HEAD', content: 'original nested/staged.ts\n' });
});

test('uses the rename source and preserves literal special paths', async t => {
  const root = await fixture(t);
  const paths = ['space name.ts', '-option.ts', '[]*:(literal).ts', '1:stage.ts'];
  for (const path of [...paths, 'before.ts']) await writeFile(join(root, path), `before ${path}\n`);
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'base');
  for (const path of paths) await writeFile(join(root, path), 'after\n');
  for (const path of paths) assert.deepEqual(await text(root, path), { label: 'HEAD', content: `before ${path}\n` }, path);
  git(root, 'mv', 'before.ts', 'after.ts');
  assert.deepEqual(await text(root, 'after.ts'), { label: 'HEAD', content: 'before before.ts\n' });
});

test('has no baseline for untracked, added, conflicted, ignored, symlinked-out or non-repository files', async t => {
  const root = await fixture(t);
  await writeFile(join(root, '.gitignore'), 'ignored\n');
  await writeFile(join(root, 'conflict'), 'base\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'base');
  const main = git(root, 'branch', '--show-current').trim();
  git(root, 'checkout', '-qb', 'other'); await writeFile(join(root, 'conflict'), 'other\n'); git(root, 'commit', '-qam', 'other');
  git(root, 'checkout', '-q', main); await writeFile(join(root, 'conflict'), 'main\n'); git(root, 'commit', '-qam', 'main');
  assert.throws(() => git(root, 'merge', 'other'));
  await writeFile(join(root, 'untracked'), 'new\n');
  await writeFile(join(root, 'added'), 'new\n'); git(root, 'add', 'added');
  await writeFile(join(root, 'ignored'), 'new\n');
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'y-term-non-git-'))); t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'file'), 'outside\n');
  await symlink(outside, join(root, 'link'));
  for (const path of ['untracked', 'added', 'conflict', 'ignored', 'link/file', 'relative']) assert.equal(await text(root, path), undefined, path);
  assert.equal(await service.baseline(1, join(outside, 'file')), undefined);
  assert.equal(await service.baseline(1, 'relative/path'), undefined);
});

test('reports missing Git, size limits, timeouts and owner disposal as errors', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'big'), 'x'.repeat(16 * 1024 * 1024 + 1)); git(root, 'add', '.'); git(root, 'commit', '-qm', 'base');
  await writeFile(join(root, 'big'), 'small\n');
  await assert.rejects(service.baseline(1, join(root, 'big')), /too large/);
  await assert.rejects(new GitService({ executable: '/does-not-exist/git' }).baseline(1, join(root, 'big')), /unavailable/);
  await assert.rejects(new GitService({ statusLimit: 4 }).baseline(1, join(root, 'big')), /too large/);
  const slow = join(root, 'slow-git'); await writeFile(slow, '#!/bin/sh\nexec /bin/sleep 10\n', { mode: 0o755 });
  await assert.rejects(new GitService({ executable: slow, timeout: 20 }).baseline(1, join(root, 'big')), /too long/);
  const disposable = new GitService({ executable: slow });
  const pending = disposable.baseline(8, join(root, 'big')); disposable.disposeOwner(8);
  await assert.rejects(pending);
});

test('parses NUL rename records, submodules, and unsupported filename encodings', () => {
  const parsed = parseGitStatus(Buffer.concat([Buffer.from('RM new name\0old name\0 M module\0?? '), Buffer.from([255]), Buffer.from('\0')]));
  assert.deepEqual(parsed.slice(0, 2), [
    { path: 'new name', originalPath: 'old name', section: 'staged', kind: 'renamed' },
    { path: 'new name', section: 'unstaged', kind: 'modified' },
  ]);
  assert.equal(parsed.at(-1)?.kind, 'unsupported-path');
  assert.equal(parseGitStatus(Buffer.from('R  new\0\uFEFFold\0'))[0].originalPath, '\uFEFFold');
});

test('locates a uniquely matching tracked or unignored file below a directory', async t => {
  const root = await fixture(t);
  for (const dir of ['app/v2/lib', 'other/v2/lib', 'app/v3']) await mkdir(join(root, dir), { recursive: true });
  for (const path of ['app/v2/lib/runner.py', 'other/v2/lib/runner.py', 'app/v3/only.py']) await writeFile(join(root, path), '');
  await writeFile(join(root, '.gitignore'), 'ignored.py\n'); await writeFile(join(root, 'app/ignored.py'), '');
  git(root, 'add', 'app/v2'); git(root, 'commit', '-qm', 'base');
  assert.equal(await service.locate(1, join(root, 'app'), 'v2/lib/runner.py'), join(root, 'app/v2/lib/runner.py'));
  assert.equal(await service.locate(1, root, 'v2/lib/runner.py'), undefined);
  assert.equal(await service.locate(1, root, 'only.py'), join(root, 'app/v3/only.py'));
  assert.equal(await service.locate(1, root, 'v3/only.py'), join(root, 'app/v3/only.py'));
  assert.equal(await service.locate(1, root, 'ly.py'), undefined);
  assert.equal(await service.locate(1, root, 'ignored.py'), undefined);
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'y-term-no-git-')));
  t.after(() => rm(outside, { recursive: true, force: true }));
  assert.equal(await service.locate(1, outside, 'runner.py'), undefined);
});
