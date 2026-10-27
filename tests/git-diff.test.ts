import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiffRows } from '../src/renderer/git-diff.ts';
import type { GitDiffResult } from '../src/shared/git-protocol.ts';

const patch = (text: string): GitDiffResult => ({ kind: 'patch', root: '/repo', entry: { path: 'file', section: 'unstaged', kind: 'modified' }, patch: text });
test('aligns unequal replacement blocks and keeps both line number sequences', () => {
  const rows = buildDiffRows(patch('@@ -2,4 +2,3 @@\n same\n-old one\n-old two\n+new\n last\n'));
  assert.deepEqual(rows.slice(1), [
    { kind: 'context', left: { number: 2, text: 'same' }, right: { number: 2, text: 'same' } },
    { kind: 'change', left: { number: 3, text: 'old one' }, right: { number: 3, text: 'new' } },
    { kind: 'change', left: { number: 4, text: 'old two' }, right: undefined },
    { kind: 'context', left: { number: 5, text: 'last' }, right: { number: 4, text: 'last' } },
  ]);
});
test('handles separate hunks, additions, deletions, CRLF and empty ranges', () => {
  const rows = buildDiffRows(patch('@@ -0,0 +1,2 @@\n+first\r\n+second\r\n@@ -10,1 +12,0 @@\n-deleted\n'));
  assert.equal(rows[1].left, undefined);
  assert.deepEqual(rows[1].right, { number: 1, text: 'first\r' });
  assert.deepEqual(rows.at(-1)?.left, { number: 10, text: 'deleted' });
  assert.equal(rows.at(-1)?.right, undefined);
});
test('keeps missing-final-newline markers outside source line numbering', () => {
  const rows = buildDiffRows(patch('@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n'));
  assert.deepEqual(rows[1], { kind: 'change', left: { number: 1, text: 'old' }, right: { number: 1, text: 'new' } });
  assert.equal(rows[2].kind, 'notice');
  assert.match(rows[2].left!.text, /No newline/); assert.match(rows[2].right!.text, /No newline/);
});
test('models untracked text as additions and leaves HTML as literal text', () => {
  const diff: GitDiffResult = { kind: 'untracked', root: '/repo', entry: { path: 'new', section: 'unstaged', kind: 'untracked' }, content: '<script>unsafe()</script>\nlast' };
  const rows = buildDiffRows(diff);
  assert.deepEqual(rows[0], { kind: 'change', left: undefined, right: { number: 1, text: '<script>unsafe()</script>' } });
  assert.equal(rows[2].kind, 'notice');
  assert.deepEqual(buildDiffRows({ ...diff, content: '' }), [{ kind: 'notice', right: { text: 'Empty file.' } }]);
});
test('shows summaries for unsupported/malformed patches and bounded rendering', () => {
  for (const text of ['@@@ -1,1 -1,1 +1,1 @@@\n+x\n', '@@ -1 +1 @@\n+missing deletion\n', 'garbage', '@@ -1 +1 @@\n!broken\n']) {
    assert.equal(buildDiffRows(patch(text))[0].kind, 'notice');
  }
  const rows = buildDiffRows(patch(`@@ -0,0 +1,10001 @@\n${'+x\n'.repeat(10001)}`));
  assert.equal(rows.length, 1); assert.match(rows[0].right!.text, /too large/i);
  assert.deepEqual(buildDiffRows({ kind: 'summary', reason: 'binary', message: 'Binary file.' }), [{ kind: 'notice', right: { text: 'Binary file.' } }]);
});
test('applies the row limit to aligned rows rather than counting both replacement columns', () => {
  const rows = buildDiffRows(patch(`@@ -1,6000 +1,6000 @@\n${'-old\n'.repeat(6000)}${'+new\n'.repeat(6000)}`));
  assert.equal(rows.length, 6001);
});
