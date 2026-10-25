import { accessSync, constants, statSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Dimensions, Preferences, PtyProcess } from '../shared/terminal-protocol.ts';

/** Query the shell itself so this also works without shell integration hooks. */
export function shellCurrentDirectory(pid: number): string | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 1) return undefined;
  try {
    const output = execFileSync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-F0n'], {
      encoding: 'utf8', timeout: 1000, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const cwd = output.split('\0').find(field => field.startsWith('n'))?.slice(1);
    if (!cwd || !isAbsolute(cwd) || cwd.length > 4096 || /[\x00-\x1f]/.test(cwd) || !statSync(cwd).isDirectory()) return undefined;
    accessSync(cwd, constants.R_OK | constants.X_OK);
    return cwd;
  } catch { return undefined; }
}

export function buildShellLaunch(preferences: Preferences, size: Dimensions, inherited: NodeJS.ProcessEnv) {
  try { accessSync(preferences.shell, constants.X_OK); }
  catch { throw new Error(`Cannot run shell: ${preferences.shell}. Update the shell path in Settings.`); }
  try { if (!statSync(preferences.cwd).isDirectory()) throw new Error(); accessSync(preferences.cwd, constants.R_OK | constants.X_OK); }
  catch { throw new Error(`Cannot open starting directory: ${preferences.cwd}. Update it in Settings.`); }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (value !== undefined && !key.startsWith('ELECTRON_') && key !== 'NODE_OPTIONS' && key !== 'NODE_CHANNEL_FD') env[key] = value;
  }
  Object.assign(env, { TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Y-Term', TERM_PROGRAM_VERSION: '0.1.0' });
  const args = ['zsh', 'bash', 'sh', 'fish'].includes(basename(preferences.shell)) ? ['-l', '-i'] : [];
  return { file: preferences.shell, args, options: { name: 'xterm-256color', cols: size.cols, rows: size.rows, cwd: preferences.cwd, env } };
}

export function descendantsOf(parent: number, snapshot: string): number[] {
  const children = new Map<number, number[]>();
  for (const line of snapshot.trim().split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(ppid) || pid <= 1) continue;
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const result: number[] = [];
  const seen = new Set([parent]);
  const visit = (pid: number) => {
    for (const child of children.get(pid) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child); visit(child); result.push(child);
    }
  };
  visit(parent);
  return result;
}

export function terminatePty(pty: PtyProcess): void {
  // Foreground programs can use a different process group and ignore SIGHUP.
  // Closing a tab ends its processes immediately, including during app quit.
  const options = { encoding: 'utf8' as const, timeout: 1000, maxBuffer: 4 * 1024 * 1024 };
  try {
    const snapshot = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,lstart='], options);
    const children = descendantsOf(pty.pid, snapshot);
    const identities = new Map(snapshot.trim().split('\n').map(line => {
      const [pid, , ...start] = line.trim().split(/\s+/);
      return [Number(pid), start.join(' ')] as const;
    }));
    if (children.length) {
      // Recheck identity immediately before signalling, without a timer that can
      // fire after a PID has been reused or after the application has quit.
      const current = execFileSync('/bin/ps', ['-p', children.join(','), '-o', 'pid=,lstart='], options);
      const live = new Map(current.trim().split('\n').map(line => {
        const [pid, ...start] = line.trim().split(/\s+/);
        return [Number(pid), start.join(' ')] as const;
      }));
      for (const pid of children) {
        if (!identities.get(pid) || live.get(pid) !== identities.get(pid)) continue;
        try { process.kill(pid, 'SIGKILL'); } catch { /* Child already exited. */ }
      }
    }
  } catch { /* PTY termination still works if process enumeration is unavailable. */ }
  try { pty.kill('SIGKILL'); } catch { /* Shell already exited. */ }
}
