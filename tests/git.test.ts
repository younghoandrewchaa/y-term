import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, symlink, chmod, realpath } from 'node:fs/promises';
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

test('lists clean repositories, untracked files, and staged additions before the first commit', async t => {
  const root = await fixture(t);
  assert.deepEqual(await service.status(1, root), { kind: 'ready', root, entries: [] });
  await writeFile(join(root, 'new.ts'), 'new line\n');
  const untracked = await service.diff(1, root, 'unstaged', 'new.ts');
  assert.equal(untracked.kind, 'untracked');
  if (untracked.kind === 'untracked') assert.equal(untracked.content, 'new line\n');
  git(root, 'add', '--', 'new.ts');
  const staged = await service.diff(1, root, 'staged', 'new.ts');
  assert.equal(staged.kind, 'patch');
  if (staged.kind === 'patch') assert.match(staged.patch, /\+new line/);
});

test('distinguishes staged and unstaged contents from nested directories and linked worktrees', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'file.ts'), 'original\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'base');
  await mkdir(join(root, 'nested'));
  await writeFile(join(root, 'file.ts'), 'staged\n'); git(root, 'add', '.');
  await writeFile(join(root, 'file.ts'), 'working\n');
  const status = await service.status(1, join(root, 'nested'));
  assert.equal(status.kind, 'ready');
  if (status.kind === 'ready') assert.deepEqual(status.entries.map(e => e.section).sort(), ['staged', 'unstaged']);
  for (const [section, expected, absent] of [['staged', '+staged', '+working'], ['unstaged', '+working', '+staged']] as const) {
    const diff = await service.diff(1, root, section, 'file.ts');
    assert.equal(diff.kind, 'patch');
    if (diff.kind === 'patch') { assert.ok(diff.patch.includes(expected)); assert.ok(!diff.patch.includes(absent)); }
  }
  const linked = join(root, 'linked'); git(root, 'worktree', 'add', '-qb', 'linked', linked);
  await writeFile(join(linked, 'file.ts'), 'linked change\n');
  const result = await service.status(2, linked);
  assert.equal(result.kind, 'ready');
  if (result.kind === 'ready') assert.equal(result.root, linked);
});

test('preserves literal special paths and rename sources without including other files', async t => {
  const root = await fixture(t);
  const paths = ['space name.ts', 'line\nbreak.ts', '-option.ts', '[]*:(literal).ts'];
  for (const path of paths) await writeFile(join(root, path), 'before\n');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'base');
  for (const path of paths) await writeFile(join(root, path), `after ${JSON.stringify(path)}\n`);
  for (const path of paths) {
    const result = await service.diff(1, root, 'unstaged', path);
    assert.equal(result.kind, 'patch');
    if (result.kind === 'patch') assert.equal((result.patch.match(/^diff --git /gm) ?? []).length, 1);
  }
  git(root, 'reset', '--hard', '-q'); git(root, 'mv', '--', paths[0], 'renamed.ts');
  const result = await service.status(1, root);
  assert.equal(result.kind, 'ready');
  if (result.kind === 'ready') assert.deepEqual(result.entries, [{ path: 'renamed.ts', originalPath: paths[0], section: 'staged', kind: 'renamed' }]);
  const rename = await service.diff(1, root, 'staged', 'renamed.ts');
  assert.equal(rename.kind, 'summary');
  if (rename.kind === 'summary') assert.equal(rename.reason, 'metadata-only');
});

test('returns deletion patches and safe binary, encoding, symlink and metadata summaries', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'deleted'), 'delete me\n'); await writeFile(join(root, 'mode'), 'same\n');
  await symlink('/outside-before', join(root, 'tracked-link'));
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'base');
  await rm(join(root, 'deleted')); await chmod(join(root, 'mode'), 0o755);
  await rm(join(root, 'tracked-link')); await symlink('/outside-after', join(root, 'tracked-link'));
  assert.equal((await service.diff(1, root, 'unstaged', 'deleted')).kind, 'patch');
  assert.equal((await service.diff(1, root, 'unstaged', 'mode')).kind, 'summary');
  const link = await service.diff(1, root, 'unstaged', 'tracked-link');
  assert.equal(link.kind, 'patch');
  if (link.kind === 'patch') assert.match(link.patch, /\+\/outside-after/);
  await writeFile(join(root, 'binary'), Buffer.from([0, 1, 2]));
  await writeFile(join(root, 'encoding'), Buffer.from([255, 254, 253]));
  await symlink('/etc/passwd', join(root, 'link'));
  for (const [path, reason] of [['binary', 'binary'], ['encoding', 'unsupported-encoding'], ['link', 'metadata-only']] as const) {
    const diff = await service.diff(1, root, 'unstaged', path);
    assert.equal(diff.kind, 'summary'); if (diff.kind === 'summary') assert.equal(diff.reason, reason);
  }
  const summary = await service.diff(1, root, 'unstaged', '../outside');
  assert.equal(summary.kind, 'summary');
  assert.equal((await service.diff(1, root, 'staged', 'binary')).kind, 'summary');
});

test('reports conflicts instead of attempting to parse combined diffs', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'conflict'), 'base\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'base');
  const branch = git(root, 'branch', '--show-current').trim(); git(root, 'checkout', '-qb', 'other');
  await writeFile(join(root, 'conflict'), 'other\n'); git(root, 'commit', '-qam', 'other'); git(root, 'checkout', '-q', branch);
  await writeFile(join(root, 'conflict'), 'ours\n'); git(root, 'commit', '-qam', 'ours');
  assert.throws(() => git(root, 'merge', 'other'));
  const diff = await service.diff(1, root, 'unstaged', 'conflict');
  assert.equal(diff.kind, 'summary'); if (diff.kind === 'summary') assert.equal(diff.reason, 'conflict');
});

test('parses NUL rename records, submodules, and unsupported filename encodings', () => {
  const parsed = parseGitStatus(Buffer.concat([Buffer.from('RM new name\0old name\0 M module\0?? '), Buffer.from([255]), Buffer.from('\0')]));
  assert.deepEqual(parsed.slice(0, 2), [
    { path: 'new name', originalPath: 'old name', section: 'staged', kind: 'renamed' },
    { path: 'new name', section: 'unstaged', kind: 'modified' },
  ]);
  assert.equal(parsed.at(-1)?.kind, 'unsupported-path');
});

test('summarizes tracked binaries, non-UTF-8 content and dirty submodules', async t => {
  const root = await fixture(t), source = await fixture(t);
  await writeFile(join(source, 'child'), 'base\n'); git(source, 'add', '.'); git(source, 'commit', '-qm', 'child');
  await writeFile(join(root, 'binary'), Buffer.from([0, 1, 2]));
  await writeFile(join(root, 'text'), 'utf8\n');
  git(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, 'module');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'base');
  await writeFile(join(root, 'binary'), Buffer.from([0, 3, 4]));
  await writeFile(join(root, 'text'), Buffer.from([255, 254]));
  await writeFile(join(root, 'module/child'), 'dirty\n');
  const status = await service.status(1, root);
  assert.equal(status.kind, 'ready');
  for (const [path, reason] of [['binary', 'binary'], ['text', 'unsupported-encoding'], ['module', 'submodule']] as const) {
    const result = await service.diff(1, root, 'unstaged', path);
    assert.equal(result.kind, 'summary'); if (result.kind === 'summary') assert.equal(result.reason, reason);
  }
});

test('handles missing Git, output limits, timeout and owner disposal explicitly', async t => {
  const root = await fixture(t);
  assert.equal((await new GitService({ executable: '/does-not-exist/git' }).status(1, root)).kind, 'unavailable');
  await writeFile(join(root, 'big'), 'x'.repeat(2 * 1024 * 1024 + 1));
  const big = await service.diff(1, root, 'unstaged', 'big');
  assert.equal(big.kind, 'summary'); if (big.kind === 'summary') assert.equal(big.reason, 'too-large');
  const limited = await new GitService({ statusLimit: 4 }).status(1, root);
  assert.equal(limited.kind, 'unavailable'); if (limited.kind === 'unavailable') assert.equal(limited.reason, 'too-large');
  const slow = join(root, 'slow-git'); await writeFile(slow, '#!/bin/sh\nexec /bin/sleep 10\n', { mode: 0o755 });
  const timed = await new GitService({ executable: slow, timeout: 20 }).status(1, root);
  assert.equal(timed.kind, 'unavailable'); if (timed.kind === 'unavailable') assert.equal(timed.reason, 'timeout');
  const disposable = new GitService({ executable: slow });
  const pending = disposable.status(8, root); disposable.disposeOwner(8);
  assert.equal((await pending).kind, 'unavailable');
  const outside = await mkdtemp(join(tmpdir(), 'y-term-non-git-')); t.after(() => rm(outside, { recursive: true, force: true }));
  const nonrepo = await service.status(1, outside);
  assert.equal(nonrepo.kind, 'unavailable'); if (nonrepo.kind === 'unavailable') assert.equal(nonrepo.reason, 'not-repository');
});
