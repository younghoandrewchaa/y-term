import test from 'node:test';
import assert from 'node:assert/strict';
import { GitPanelController } from '../src/renderer/git-panel.ts';
import type { GitDiffResult, GitStatusResult } from '../src/shared/git-protocol.ts';

const ready = (root = '/repo', paths = ['a', 'b']): GitStatusResult => ({ kind: 'ready', root, entries: paths.flatMap(path => (['unstaged', 'staged'] as const).map(section => ({ path, section, kind: 'modified' as const }))) });
const diff = (text: string): GitDiffResult => ({ kind: 'summary', reason: 'metadata-only', message: text });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function setup() {
  let serial = 0;
  const timers = new Map<number, () => void>();
  const scheduler = { schedule(fn: () => void, ms: number) { assert.equal(ms, 2000); timers.set(++serial, fn); return serial; }, cancel(id: unknown) { timers.delete(id as number); } };
  let text = 'first';
  const calls: string[] = [];
  const api = {
    async getGitStatus(id: string) { calls.push(`status:${id}`); return ready(); },
    async getGitDiff(id: string, section: string, path: string) { calls.push(`diff:${id}:${section}:${path}`); return diff(text); },
  };
  const controller = new GitPanelController(api, () => {}, scheduler);
  controller.setSession('one');
  return { controller, timers, calls, api, edit: (value: string) => { text = value; } };
}

test('loads selection, switches section, and refreshes contents even when status is unchanged', async () => {
  const { controller, calls, edit } = setup();
  controller.setVisible(true); await settle();
  assert.equal(controller.state.selected, 'a'); assert.deepEqual(controller.state.diff, diff('first'));
  controller.select('b'); await settle();
  assert.equal(controller.state.selected, 'b');
  controller.setSection('staged'); await settle();
  assert.equal(controller.state.section, 'staged'); assert.ok(calls.includes('diff:one:staged:a'));
  edit('second'); await controller.refresh();
  assert.deepEqual(controller.state.diff, diff('second'));
  controller.dispose();
});

test('discards late responses after selection, tab, directory and visibility changes', async () => {
  const { controller, api } = setup();
  controller.setVisible(true); await settle();
  const late = deferred<GitDiffResult>();
  api.getGitDiff = async () => late.promise;
  const pending = controller.refresh(); await settle();
  controller.select('b');
  assert.equal(controller.state.diff, undefined);
  controller.setSession('two'); controller.directoryChanged(); controller.setVisible(false);
  late.resolve(diff('wrong repository')); await pending; await settle();
  assert.equal(controller.state.status, undefined); assert.equal(controller.state.diff, undefined);
  api.getGitDiff = async () => diff('current repository');
  controller.setVisible(true); await settle();
  assert.deepEqual(controller.state.diff, diff('current repository'));
  controller.dispose();
});

test('coalesces refresh requests and pauses polling when hidden, unfocused or disposed', async () => {
  const { controller, timers, api, calls } = setup();
  controller.setVisible(true); await settle();
  assert.equal(timers.size, 1);
  const late = deferred<GitStatusResult>();
  api.getGitStatus = async () => { calls.push('pending'); return late.promise; };
  const pending = controller.refresh();
  void controller.refresh(); void controller.refresh();
  assert.equal(calls.filter(c => c === 'pending').length, 1);
  api.getGitStatus = async () => { calls.push('followup'); return ready(); };
  late.resolve(ready()); await pending; await settle();
  assert.equal(calls.filter(c => c === 'followup').length, 1);
  controller.setFocused(false); assert.equal(timers.size, 0);
  controller.setFocused(true); await settle(); assert.equal(timers.size, 1);
  const poll = [...timers.values()][0]; timers.clear(); poll(); await settle(); assert.equal(timers.size, 1);
  controller.setVisible(false); assert.equal(timers.size, 0);
  controller.dispose(); controller.setVisible(true); await settle(); assert.equal(timers.size, 0);
});

test('clears removed selections and unavailable repositories instead of keeping old diffs', async () => {
  const { controller, api } = setup();
  controller.setVisible(true); await settle();
  api.getGitStatus = async () => ready('/repo', []);
  await controller.refresh();
  assert.equal(controller.state.selected, undefined); assert.equal(controller.state.diff, undefined);
  api.getGitStatus = async () => ({ kind: 'unavailable', reason: 'not-repository', message: 'Outside Git.' });
  await controller.refresh();
  assert.equal(controller.state.status?.kind, 'unavailable'); assert.equal(controller.state.diff, undefined);
  controller.dispose();
});

test('rejects a diff from a changed root and recovers from a failed request', async () => {
  const { controller, api } = setup();
  api.getGitDiff = async () => ({ kind: 'patch', root: '/other', entry: { path: 'a', section: 'unstaged', kind: 'modified' }, patch: '@@ -1 +1 @@\n-old\n+new\n' });
  controller.setVisible(true); await settle();
  assert.equal(controller.state.diff?.kind, 'summary');
  api.getGitStatus = async () => { throw new Error('Session gone'); };
  await controller.refresh();
  assert.equal(controller.state.status?.kind, 'unavailable');
  assert.equal(controller.state.busy, false);
  controller.dispose();
});
