import test from 'node:test';
import assert from 'node:assert/strict';
import { detachOpener, insertAfterOpener, moveTab, shortcutTabIndex, tabShortcutDigit } from '../src/shared/tab-order.ts';

interface Node { id: string; opener?: Node }
const node = (id: string, opener?: Node): Node => ({ id, opener });
const openerOf = (item: Node) => item.opener;
const ids = (items: Node[]) => items.map(item => item.id);

test('places children of the same tab in the order they opened', () => {
  const a = node('a'); const items = [a];
  insertAfterOpener(items, node('b', a), a, openerOf);
  insertAfterOpener(items, node('c', a), a, openerOf);
  assert.deepEqual(ids(items), ['a', 'b', 'c']);
});

test('skips grandchildren and stops at unrelated tabs', () => {
  const a = node('a'); const x = node('x'); const items = [a, x];
  const b = node('b', a); insertAfterOpener(items, b, a, openerOf);
  insertAfterOpener(items, node('d', b), b, openerOf);
  assert.equal(insertAfterOpener(items, node('e', a), a, openerOf), 3);
  assert.deepEqual(ids(items), ['a', 'b', 'd', 'e', 'x']);
});

test('a tab with no children gets its new tab directly after it', () => {
  const a = node('a'); const x = node('x'); const items = [a, x];
  assert.equal(insertAfterOpener(items, node('b', a), a, openerOf), 1);
  assert.deepEqual(ids(items), ['a', 'b', 'x']);
});

test('appends without a source or with one that is gone', () => {
  const a = node('a'); const items = [a];
  assert.equal(insertAfterOpener(items, node('b'), undefined, openerOf), 1);
  assert.equal(insertAfterOpener(items, node('c'), node('gone'), openerOf), 2);
  assert.deepEqual(ids(items), ['a', 'b', 'c']);
});

test('children of a closed tab do not join another tab\'s run', () => {
  const closed = node('closed'); const a = node('a');
  const items = [a, node('orphan', closed)];
  insertAfterOpener(items, node('b', a), a, openerOf);
  assert.deepEqual(ids(items), ['a', 'b', 'orphan']);
});

test('⌘1–⌘8 pick a position and ⌘9 picks the last tab', () => {
  assert.equal(shortcutTabIndex(1, 3), 0);
  assert.equal(shortcutTabIndex(3, 3), 2);
  assert.equal(shortcutTabIndex(4, 3), undefined);
  assert.equal(shortcutTabIndex(9, 3), 2);
  assert.equal(shortcutTabIndex(9, 12), 11);
  assert.equal(shortcutTabIndex(8, 12), 7);
  assert.equal(shortcutTabIndex(1, 0), undefined);
  assert.equal(shortcutTabIndex(9, 0), undefined);
});

test('the first eight tabs and the last tab show their shortcut digit', () => {
  assert.deepEqual([0, 1, 2].map(index => tabShortcutDigit(index, 3)), [1, 2, 3]);
  assert.deepEqual([0, 7, 8, 9, 10, 11].map(index => tabShortcutDigit(index, 12)), [1, 8, undefined, undefined, undefined, 9]);
  assert.equal(tabShortcutDigit(8, 9), 9);
  for (let count = 1; count <= 12; count++) for (let index = 0; index < count; index++) {
    const digit = tabShortcutDigit(index, count);
    if (digit !== undefined) assert.equal(shortcutTabIndex(digit, count), index);
  }
});

test('closing a tab hands its children to its own opener, as Chrome does', () => {
  const x = node('x'); const a = node('a', x); const a1 = node('a1', a); const y = node('y');
  const items = [x, a1, y]; // a has just been closed
  detachOpener(items, a);
  assert.equal(a1.opener, x);
  assert.equal(a.opener, undefined, 'the closed tab lets go of its own opener');
  insertAfterOpener(items, node('new', x), x, openerOf);
  assert.deepEqual(ids(items), ['x', 'a1', 'new', 'y']);
});

test('dragging a tab down lands it in the slot the drop line showed', () => {
  const items = ['a', 'b', 'c', 'd'].map(id => node(id));
  assert.equal(moveTab(items, 0, 3), true); // drop line between c and d
  assert.deepEqual(ids(items), ['b', 'c', 'a', 'd']);
});

test('dragging a tab up lands it in the slot the drop line showed', () => {
  const items = ['a', 'b', 'c', 'd'].map(id => node(id));
  assert.equal(moveTab(items, 3, 1), true); // drop line between a and b
  assert.deepEqual(ids(items), ['a', 'd', 'b', 'c']);
  assert.equal(moveTab(items, 0, 4), true); // after the last tab
  assert.deepEqual(ids(items), ['d', 'b', 'c', 'a']);
});

test('dropping a tab beside itself changes nothing', () => {
  const a = node('a'); const b = node('b', a); const items = [a, b, node('c')];
  assert.equal(moveTab(items, 1, 1), false);
  assert.equal(moveTab(items, 1, 2), false);
  assert.equal(moveTab(items, 5, 0), false);
  assert.equal(moveTab(items, 0, 9), false);
  assert.deepEqual(ids(items), ['a', 'b', 'c']);
  assert.equal(b.opener, a, 'a no-op keeps the opener');
});

test('a moved tab forgets its opener so new tabs no longer group with it', () => {
  const a = node('a'); const b = node('b', a); const items = [a, b, node('x')];
  moveTab(items, 1, 3);
  assert.equal(b.opener, undefined);
  insertAfterOpener(items, node('n', a), a, openerOf);
  assert.deepEqual(ids(items), ['a', 'n', 'x', 'b']);
});
