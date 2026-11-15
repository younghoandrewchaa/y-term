import test from 'node:test';
import assert from 'node:assert/strict';
import { inboxPosition, inboxQueue, inboxStep } from '../src/shared/inbox.ts';

interface Item { id: string; at?: number }
const a: Item = { id: 'a', at: 3 }, b: Item = { id: 'b' }, c: Item = { id: 'c', at: 1 }, d: Item = { id: 'd', at: 3 };
const at = (item: Item) => item.at;

test('queues blocked items oldest first, keeping sidebar order for ties', () => {
  assert.deepEqual(inboxQueue([a, b, c, d], at), [c, a, d]);
  assert.deepEqual(inboxQueue([], at), []);
});

test('steps through the queue and wraps round', () => {
  const queue = inboxQueue([a, b, c, d], at);
  assert.equal(inboxStep(queue, a, 1), d);
  assert.equal(inboxStep(queue, d, 1), c);
  assert.equal(inboxStep(queue, c, -1), d);
});

test('a resolved or missing current item steps to the ends of the queue', () => {
  const queue = inboxQueue([a, b, c, d], at);
  assert.equal(inboxStep(queue, b, 1), c);
  assert.equal(inboxStep(queue, b, -1), d);
  assert.equal(inboxStep(queue, undefined, 1), c);
  assert.equal(inboxStep([], a, 1), undefined);
});

test('reports a 1-based position only for queued items', () => {
  const queue = inboxQueue([a, b, c, d], at);
  assert.deepEqual(inboxPosition(queue, a), { position: 2, count: 3 });
  assert.equal(inboxPosition(queue, b), undefined);
});

test('an item blocked again goes to the back of the queue', () => {
  const again: Item = { ...a, at: 9 };
  const queue = inboxQueue([again, b, c, d], at);
  assert.deepEqual(queue, [c, d, again]);
  assert.deepEqual(inboxPosition(queue, again), { position: 3, count: 3 });
});
