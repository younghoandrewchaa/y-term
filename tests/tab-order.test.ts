import test from 'node:test';
import assert from 'node:assert/strict';
import { compareTabs } from '../src/shared/tab-order.ts';
import type { TabSortKey } from '../src/shared/tab-order.ts';

const sorted = (keys: (TabSortKey & { id?: string })[]) => [...keys].sort(compareTabs);
const tab = (directory: string, agent = false, id?: string) => ({ directory, agent, id });

test('sorts by directory name, ignoring case and comparing numbers', () => {
  assert.deepEqual(sorted([tab('zeta'), tab('Beta'), tab('alpha'), tab('gamma')]).map(key => key.directory),
    ['alpha', 'Beta', 'gamma', 'zeta']);
  assert.deepEqual(sorted([tab('app10'), tab('app2')]).map(key => key.directory), ['app2', 'app10']);
  assert.deepEqual(sorted([tab('project folder'), tab('/')]).map(key => key.directory), ['/', 'project folder']);
});

test('puts running agents first within a directory and keeps order otherwise', () => {
  const order = sorted([tab('b', false, '1'), tab('a', false, '2'), tab('a', true, '3'), tab('a', false, '4'), tab('a', true, '5')]);
  assert.deepEqual(order.map(key => key.id), ['3', '5', '2', '4', '1']);
});
