import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isSessionId } from '../shared/agent-resume.ts';
import type { AgentResume } from '../shared/agent-resume.ts';
import { agentProcessOf } from './shell.ts';

interface Inspect {
  run(file: string, args: string[]): string;
  read(path: string): string;
  claudeDirectory: string;
  codexDirectory: string;
}

const system: Inspect = {
  run: (file, args) => execFileSync(file, args, {
    encoding: 'utf8', timeout: 1000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  }),
  read: path => readFileSync(path, 'utf8'),
  claudeDirectory: process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'),
  codexDirectory: process.env.CODEX_HOME || join(homedir(), '.codex'),
};

/** Lists every process once so all tabs share one consistent view. */
export function processSnapshot(inspect: Pick<Inspect, 'run'> = system): string | undefined {
  try { return inspect.run('/bin/ps', ['-axo', 'pid=,ppid=,args=']); }
  catch { return undefined; }
}

/**
 * Claude Code records each interactive process in `sessions/<pid>.json`. Only that exact
 * file is read; the start time guards against a reused PID naming someone else's session.
 */
export function claudeSession(pid: number, cwd: string, started: string, inspect: Pick<Inspect, 'read' | 'claudeDirectory'>): AgentResume | undefined {
  const normal = (value: unknown) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : undefined;
  try {
    const record = JSON.parse(inspect.read(join(inspect.claudeDirectory, 'sessions', `${pid}.json`)));
    if (record?.pid !== pid || record.cwd !== cwd || !normal(started) || normal(record.procStart) !== normal(started)) return undefined;
    return isSessionId(record.sessionId) ? { agent: 'claude', id: record.sessionId } : undefined;
  } catch { return undefined; }
}

/** Codex keeps its transcript, `sessions/…/rollout-<timestamp>-<session id>.jsonl`, open while it runs. */
export function codexSession(lsof: string, codexDirectory: string): AgentResume | undefined {
  for (const field of lsof.split(/[\0\n]/)) {
    if (!field.startsWith(`n${join(codexDirectory, 'sessions')}/`)) continue;
    const id = /\/rollout-[^/]*-([0-9a-f-]{36})\.jsonl$/.exec(field)?.[1];
    if (isSessionId(id)) return { agent: 'codex', id };
  }
  return undefined;
}

/** The conversation an agent below this shell is running, if it can be identified exactly. */
export function agentSessionOf(shellPid: number, cwd: string, processes: string, inspect: Inspect = system): AgentResume | undefined {
  const agent = agentProcessOf(shellPid, processes);
  try {
    if (agent?.name === 'Claude') return claudeSession(agent.pid, cwd, inspect.run('/bin/ps', ['-p', String(agent.pid), '-o', 'lstart=']), inspect);
    if (agent?.name === 'Codex') return codexSession(inspect.run('/usr/sbin/lsof', ['-a', '-p', String(agent.pid), '-Fn', '-0']), inspect.codexDirectory);
  } catch { /* The agent exited or could not be inspected; the tab still reopens. */ }
  return undefined;
}
