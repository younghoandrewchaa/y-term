import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveFileLink, openFileLink } from '../src/main/file-links.ts';

test('resolves local paths and line references without interpreting shell syntax', () => {
  assert.equal(resolveFileLink('docs/plan.md:12:4', '/project', '/home/me'), '/project/docs/plan.md');
  assert.equal(resolveFileLink('../plan.md', '/project/docs', '/home/me'), '/project/plan.md');
  assert.equal(resolveFileLink('~/My Documents/plan.md', undefined, '/home/me'), '/home/me/My Documents/plan.md');
  assert.equal(resolveFileLink('/tmp/$(touch nope).md', undefined, '/home/me'), '/tmp/$(touch nope).md');
  assert.equal(resolveFileLink('file:///tmp/my%20plan.md#L12', undefined, '/home/me'), '/tmp/my plan.md');
  assert.equal(resolveFileLink('file://localhost/tmp/plan.md', undefined, '/home/me'), '/tmp/plan.md');
  assert.equal(resolveFileLink('file:///tmp/notes%3A2026', undefined, '/home/me'), '/tmp/notes:2026');
  assert.equal(resolveFileLink('file:///tmp/plan.md:12:4', undefined, '/home/me'), '/tmp/plan.md');
  assert.equal(resolveFileLink('v2/runner.py:1272-1346', '/project', '/home/me'), '/project/v2/runner.py');
  assert.equal(resolveFileLink('runner.py:12-40', '/project', '/home/me'), '/project/runner.py');
});

test('rejects unavailable directories, controls, remote file URLs and other protocols', () => {
  assert.throws(() => resolveFileLink('docs/plan.md', undefined, '/home/me'), /directory/i);
  for (const value of [null, '', '/tmp/a\n.md', '/tmp/a\0.md', 'https://example.com/a.md', 'javascript:alert(1)',
    'file://remote/tmp/a.md', 'file:///tmp/%zz', 'file:///tmp/a.md?query=1', 'file:///tmp/a%00.md']) {
    assert.throws(() => resolveFileLink(value, '/project', '/home/me'), Error, String(value));
  }
});

test('opens existing files and reports missing files or native app failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'y-term-file-links-'));
  try {
    const path = join(directory, 'plan.md');
    await writeFile(path, 'plan');
    const opened: string[] = [];
    await openFileLink('plan.md:10', directory, '/home/me', async value => { opened.push(value); return ''; });
    assert.deepEqual(opened, [path]);
    await assert.rejects(openFileLink('missing.md', directory, '/home/me', async () => { assert.fail('must not open missing files'); }), /ENOENT/);
    await assert.rejects(openFileLink('plan.md', directory, '/home/me', async () => 'No default app'), /No default app/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('tries a diff first unless the link points at a line, and opens the file when there is no diff', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'y-term-file-links-'));
  try {
    const path = join(directory, 'plan.md');
    await writeFile(path, 'plan');
    const opened: string[] = [], diffed: string[] = [];
    const open = async (value: string) => { opened.push(value); return ''; };
    await openFileLink('plan.md', directory, '/home/me', open, async value => { diffed.push(value); return true; });
    assert.deepEqual([opened, diffed], [[], [path]]);
    await openFileLink('plan.md', directory, '/home/me', open, async () => false);
    assert.deepEqual(opened, [path]);
    await openFileLink('plan.md:12', directory, '/home/me', open, async () => assert.fail('line references must not diff'));
    assert.deepEqual(opened, [path, path]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('searches for relative links missing from the current directory and never diffs line ranges', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'y-term-file-links-'));
  try {
    const path = join(directory, 'nested', 'runner.py');
    await mkdir(join(directory, 'nested'));
    await writeFile(path, 'runner');
    const opened: string[] = [], searched: string[] = [];
    const open = async (value: string) => { opened.push(value); return ''; };
    const locate = async (value: string) => { searched.push(value); return value === 'runner.py' ? path : undefined; };
    await openFileLink('./runner.py:1272-1346', directory, '/home/me', open, async () => assert.fail('line ranges must not diff'), locate);
    assert.deepEqual([opened, searched], [[path], ['runner.py']]);
    await assert.rejects(openFileLink('other.py', directory, '/home/me', open, undefined, locate), /ENOENT/);
    for (const value of ['../runner.py', '/tmp/runner.py', '~/runner.py']) {
      await assert.rejects(openFileLink(value, directory, '/home/me', open, undefined, async () => assert.fail(`must not search for ${value}`)), /ENOENT/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
