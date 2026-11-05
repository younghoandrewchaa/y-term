import test from 'node:test';
import assert from 'node:assert/strict';
import { insertAfterOpener } from '../src/shared/tab-order.ts';

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
