import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentStatus, reduceAgentStatus, agentStatusLabel } from '../src/shared/agent-status.ts';
import type { AgentReport, AgentStatusState } from '../src/shared/agent-status.ts';

const initial: AgentStatusState = { unseenCompletion: false };
const report = (state: AgentReport['state'], viewed = false, previous = initial, id = '') =>
  reduceAgentStatus(previous, { type: 'report', report: { state, id }, viewed });

test('parses root and child OSC 7501 reports without guessing from other notifications', () => {
  assert.deepEqual(parseAgentStatus('state=working:app=codex:progress=40'), { state: 'working', id: '', app: 'codex' });
  assert.deepEqual(parseAgentStatus('state=blocked:kind=permission:id=build/test:msg=QXBwbHk/'), { state: 'blocked', id: 'build/test' });
  assert.deepEqual(parseAgentStatus(' state = idle :future=yes:oops:state=done'), { state: 'done', id: '' });
  assert.deepEqual(parseAgentStatus('state=error:app=invalid/name'), { state: 'error', id: '' });
  assert.deepEqual(parseAgentStatus('state=clear'), { state: 'clear', id: '' });
  for (const data of ['', '?', '?:states=idle,working', 'notify;Codex;Finished', 'app=codex', 'state=bogus', 'state=WORKING']) {
    assert.equal(parseAgentStatus(data), undefined, data);
  }
});

test('rejects invalid record ids instead of applying child clear to the root', () => {
  for (const id of ['', '/', 'a/', '/a', 'a//b', 'a,b', 'a=b', 'bad@id', 'a'.repeat(33), 'a/b/c/d/e/f/g/h/i']) {
    assert.equal(parseAgentStatus(`state=clear:id=${id}`), undefined, id);
  }
});

test('bounds reports and validates encoded text before changing status', () => {
  for (const data of [
    `state=idle:${'x'.repeat(4080)}`, `state=idle:${'k'.repeat(17)}=1`,
    `state=idle:app=${'a'.repeat(33)}:app=ok`, `state=idle:title=${'QUFB'.repeat(65)}`,
    `state=idle:msg=${'QUFB'.repeat(683)}`, 'state=done:msg=a', 'state=done:msg=QQ=',
    'state=done:msg=YQpi', 'state=done:title=wps=', 'state=done:msg=/w==',
  ]) assert.equal(parseAgentStatus(data), undefined, data.slice(0, 80));
  assert.deepEqual(parseAgentStatus('state=done:msg=UGxhbg:title=5a6J5YWo'), { state: 'done', id: '' });
});

test('displays lifecycle reports separately from unseen completion', () => {
  assert.equal(agentStatusLabel(initial), undefined);
  assert.equal(agentStatusLabel(report('idle')), 'Idle');
  assert.equal(agentStatusLabel(report('done')), 'Idle');
  const working = report('working');
  assert.equal(agentStatusLabel(working), 'Working');
  for (const finished of ['idle', 'done'] as const) {
    assert.equal(agentStatusLabel(report(finished, true, working)), 'Idle');
    const done = report(finished, false, working);
    assert.equal(agentStatusLabel(done), 'Done');
    assert.equal(agentStatusLabel(report('idle', false, done)), 'Done');
    const seen = reduceAgentStatus(done, { type: 'viewed' });
    assert.equal(agentStatusLabel(seen), 'Idle');
    assert.equal(agentStatusLabel(report('done', false, seen)), 'Idle');
    assert.equal(agentStatusLabel(report('working', false, done)), 'Working');
    assert.equal(agentStatusLabel(report('blocked', false, done)), 'Blocked');
  }
});

test('viewing a blocked or errored agent does not resolve its status', () => {
  for (const word of ['blocked', 'error'] as const) {
    const blocked = report(word);
    assert.equal(agentStatusLabel(reduceAgentStatus(blocked, { type: 'viewed' })), 'Blocked');
    assert.equal(agentStatusLabel(report('working', true, blocked)), 'Working');
  }
  for (const word of ['blocked', 'error'] as const) {
    for (const finished of ['idle', 'done'] as const) {
      const blocked = report(word, false, report('working'));
      const completed = report(finished, false, blocked);
      assert.equal(agentStatusLabel(completed), 'Done', `${word} → ${finished} elsewhere`);
      assert.equal(agentStatusLabel(report(finished, true, blocked)), 'Idle');
      const seen = reduceAgentStatus(completed, { type: 'viewed' });
      assert.equal(agentStatusLabel(report(finished, false, seen)), 'Idle');
    }
  }
});

test('child reports do not replace root status, and clear/reset remove it', () => {
  const working = report('working');
  assert.deepEqual(report('blocked', false, working, 'worker'), working);
  assert.deepEqual(report('clear', false, working, 'worker'), working);
  assert.equal(agentStatusLabel(report('clear', false, working)), undefined);
  assert.equal(agentStatusLabel(reduceAgentStatus(working, { type: 'reset' })), undefined);
});
