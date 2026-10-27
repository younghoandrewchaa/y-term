import test from 'node:test';
import assert from 'node:assert/strict';
import { agentSessionOf, claudeSession, codexSession } from '../src/main/agent-sessions.ts';
import { resumeCommand } from '../src/shared/agent-resume.ts';

const id = '0b6c2f0e-3d4a-4c1b-9e8f-1a2b3c4d5e6f';
const started = 'Tue Oct  7 21:37:16 2026';
function inspect(record: object | undefined, reads: string[] = []) {
  return {
    claudeDirectory: '/home/me/.claude', codexDirectory: '/home/me/.codex',
    read: (path: string) => { reads.push(path); if (!record) throw new Error('missing'); return JSON.stringify(record); },
    run: (file: string) => file === '/bin/ps' ? `${started}\n` : '',
  };
}
const record = { pid: 11, sessionId: id, cwd: '/work', procStart: 'Tue Oct 7 21:37:16 2026' };

test('identifies a Claude session only from its own process record', () => {
  const reads: string[] = [];
  assert.deepEqual(claudeSession(11, '/work', started, inspect(record, reads)), { agent: 'claude', id });
  assert.deepEqual(reads, ['/home/me/.claude/sessions/11.json']);
  for (const value of [
    { ...record, pid: 12 }, { ...record, cwd: '/elsewhere' }, { ...record, procStart: 'Wed Oct 8 09:00:00 2026' },
    { ...record, sessionId: '../../etc/passwd' }, { ...record, sessionId: undefined }, undefined,
  ]) assert.equal(claudeSession(11, '/work', started, inspect(value)), undefined, JSON.stringify(value));
  assert.equal(claudeSession(11, '/work', '', inspect({ ...record, procStart: '' })), undefined);
});

test('identifies a Codex session from its open transcript', () => {
  const lsof = `p21\0fcwd\0n/work\0\nf3\0n/home/me/.codex/sessions/2026/10/27/rollout-2026-10-27T10-00-00-${id}.jsonl\0\n`;
  assert.deepEqual(codexSession(lsof, '/home/me/.codex'), { agent: 'codex', id });
  assert.equal(codexSession(lsof.replaceAll('/home/me/.codex', '/tmp/other'), '/home/me/.codex'), undefined);
  assert.equal(codexSession('n/home/me/.codex/sessions/rollout-x-not-a-uuid.jsonl\0', '/home/me/.codex'), undefined);
});

test('resumes the outermost agent below the shell and ignores other agents', () => {
  const processes = '10 1 -zsh\n11 10 claude\n12 11 /bin/zsh -c claude -p hi\n13 12 claude -p hi\n20 1 -zsh\n21 20 aider\n';
  const reads: string[] = [];
  assert.deepEqual(agentSessionOf(10, '/work', processes, inspect(record, reads)), { agent: 'claude', id });
  assert.deepEqual(reads, ['/home/me/.claude/sessions/11.json']);
  assert.equal(agentSessionOf(20, '/work', processes, inspect(record)), undefined);
  assert.equal(agentSessionOf(10, '/work', processes, { ...inspect(record), run: () => { throw new Error('gone'); } }), undefined);
});

test('builds resume commands only from fixed templates', () => {
  assert.equal(resumeCommand({ agent: 'claude', id }), `claude --resume ${id}`);
  assert.equal(resumeCommand({ agent: 'codex', id }), `codex resume ${id}`);
  assert.throws(() => resumeCommand({ agent: 'claude', id: `${id}; rm -rf ~` }));
  assert.throws(() => resumeCommand({ agent: 'sh' as 'claude', id }));
});
