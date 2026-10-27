import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { GitDiffResult, GitEntry, GitSection, GitStatusResult } from '../shared/git-protocol.ts';

const STATUS_LIMIT = 4 * 1024 * 1024;
const DIFF_LIMIT = 2 * 1024 * 1024;
const conflicts = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
type FailureReason = 'not-repository' | 'git-missing' | 'too-large' | 'timeout' | 'error';
class GitFailure extends Error {
  readonly reason: FailureReason;
  constructor(reason: FailureReason, message: string) { super(message); this.reason = reason; }
}
const summary = (reason: Extract<GitDiffResult, { kind: 'summary' }>['reason'], message: string): GitDiffResult => ({ kind: 'summary', reason, message });
function validPath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length <= 32768 && !path.includes('\0')
    && !isAbsolute(path) && !path.split('/').some(part => part === '..' || part === '.' || part === '');
}

export function parseGitStatus(buffer: Buffer): GitEntry[] {
  const records: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) if (buffer[i] === 0) { records.push(buffer.subarray(start, i)); start = i + 1; }
  if (start !== buffer.length) throw new GitFailure('error', 'Incomplete Git status output.');
  const entries: GitEntry[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.length < 4 || record[2] !== 32) throw new GitFailure('error', 'Invalid Git status output.');
    const xy = record.subarray(0, 2).toString('ascii');
    const rawPath = record.subarray(3);
    let path = rawPath.toString('utf8'), originalPath: string | undefined;
    let supported = true;
    try { path = utf8.decode(rawPath); } catch { supported = false; }
    if (/[RC]/.test(xy)) {
      const source = records[++i];
      if (!source) throw new GitFailure('error', 'Incomplete rename record.');
      try { originalPath = utf8.decode(source); } catch { supported = false; }
    }
    const add = (section: GitSection, kind: GitEntry['kind'], original = false) => {
      entries.push({ path, ...(original && originalPath !== undefined ? { originalPath } : {}), section, kind: supported ? kind : 'unsupported-path' });
    };
    if (xy === '??') { add('unstaged', 'untracked'); continue; }
    if (conflicts.has(xy)) { add('unstaged', 'conflicted'); continue; }
    const kind = (code: string): GitEntry['kind'] => ({ M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'added', T: 'type-changed' })[code] as GitEntry['kind'] ?? 'modified';
    if (xy[0] !== ' ' && xy[0] !== '!') add('staged', kind(xy[0]), true);
    if (xy[1] !== ' ' && xy[1] !== '!') add('unstaged', kind(xy[1]), xy[1] === 'R');
  }
  return entries;
}

export class GitService {
  private processes = new Map<number, Set<ChildProcess>>();
  private disposed = new Set<number>();
  private options: { executable?: string; timeout?: number; statusLimit?: number };
  constructor(options: { executable?: string; timeout?: number; statusLimit?: number } = {}) { this.options = options; }

  disposeOwner(owner: number): void {
    this.disposed.add(owner);
    for (const child of this.processes.get(owner) ?? []) child.kill('SIGKILL');
    this.processes.delete(owner);
  }

  private run(owner: number, cwd: string, args: string[], limit: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (this.disposed.has(owner)) { reject(new GitFailure('error', 'This window has closed.')); return; }
      const running = this.processes.get(owner) ?? new Set<ChildProcess>();
      if (running.size >= 2) { reject(new GitFailure('error', 'Git is busy. Try again.')); return; }
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
      Object.assign(env, { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' });
      const child = spawn(this.options.executable ?? 'git', [
        '--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
        '-c', 'diff.suppressBlankEmpty=false',
        ...args,
      ], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      running.add(child); this.processes.set(owner, running);
      const output: Buffer[] = []; const errors: Buffer[] = [];
      let bytes = 0, errorBytes = 0, failure: GitFailure | undefined;
      const stop = (reason: FailureReason, message: string) => { failure ??= new GitFailure(reason, message); child.kill('SIGKILL'); };
      const timer = setTimeout(() => stop('timeout', 'Git took too long. Refresh to try again.'), this.options.timeout ?? 5000);
      child.stdout.on('data', (data: Buffer) => {
        bytes += data.length;
        if (bytes > limit) stop('too-large', 'These changes are too large to display.');
        else output.push(data);
      });
      child.stderr.on('data', (data: Buffer) => { errorBytes += data.length; if (errorBytes <= 65536) errors.push(data); });
      const cleanup = () => { clearTimeout(timer); running.delete(child); if (!running.size) this.processes.delete(owner); };
      child.on('error', error => {
        cleanup(); reject(new GitFailure((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'git-missing' : 'error', 'Git is unavailable. Install Git and try again.'));
      });
      child.on('close', code => {
        cleanup();
        if (failure) { reject(failure); return; }
        if (this.disposed.has(owner)) { reject(new GitFailure('error', 'This window has closed.')); return; }
        if (code !== 0) {
          const error = Buffer.concat(errors).toString('utf8');
          reject(new GitFailure(/not a git repository/i.test(error) ? 'not-repository' : 'error', /not a git repository/i.test(error) ? 'This terminal is outside a Git repository.' : `Could not read Git changes. ${error.slice(0, 500).trim()}`));
        } else resolve(Buffer.concat(output));
      });
    });
  }

  async status(owner: number, cwd: string): Promise<GitStatusResult> {
    try {
      const rootBytes = await this.run(owner, cwd, ['rev-parse', '--show-toplevel'], STATUS_LIMIT);
      const root = await realpath(utf8.decode(rootBytes).replace(/\n$/, ''));
      const output = await this.run(owner, root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'], this.options.statusLimit ?? STATUS_LIMIT);
      return { kind: 'ready', root, entries: parseGitStatus(output) };
    } catch (error) {
      return { kind: 'unavailable', reason: error instanceof GitFailure ? error.reason : 'error', message: error instanceof Error ? error.message : 'Could not read Git changes.' };
    }
  }

  async diff(owner: number, cwd: string, section: GitSection, path: string): Promise<GitDiffResult> {
    if (!validPath(path) || !['unstaged', 'staged'].includes(section)) return summary('error', 'Invalid Git file request.');
    const status = await this.status(owner, cwd);
    if (status.kind !== 'ready') return summary(status.reason === 'too-large' ? 'too-large' : 'error', status.message);
    const entry = status.entries.find(e => e.path === path && e.section === section);
    if (!entry) return summary('stale', 'This file has changed or is no longer in this list. Refresh to try again.');
    if (entry.kind === 'unsupported-path') return summary('unsupported-encoding', 'This filename is not UTF-8 and cannot be displayed.');
    if (entry.kind === 'conflicted') return summary('conflict', 'This file has merge conflicts. Resolve them in your editor or terminal.');
    try {
      if (entry.kind === 'untracked') return await this.untracked(status.root, entry);
      const patchBytes = await this.run(owner, status.root, [
        'diff', ...(section === 'staged' ? ['--cached'] : []), '--patch', '--unified=3', '--no-color', '--no-ext-diff', '--no-textconv',
        '--no-relative', '--src-prefix=a/', '--dst-prefix=b/', '--line-prefix=', '--output-indicator-new=+', '--output-indicator-old=-',
        '--output-indicator-context= ', '--find-renames', '--ignore-submodules=none', '--submodule=short', '--',
        ...(entry.originalPath && validPath(entry.originalPath) ? [entry.originalPath] : []), entry.path,
      ], DIFF_LIMIT);
      let patch: string;
      try { patch = utf8.decode(patchBytes); } catch { return summary('unsupported-encoding', 'This file is not UTF-8 and cannot be displayed.'); }
      if (/^Binary files /m.test(patch) || patch.includes('\0')) return summary('binary', 'Binary file — text comparison is unavailable.');
      if (/^index .* 160000$/m.test(patch) || /^[-+]Subproject commit /m.test(patch)) return summary('submodule', 'Submodule changes — inspect this repository in the terminal.');
      if (!/^@@ /m.test(patch)) return summary('metadata-only', patch ? 'Only file metadata changed (rename, permissions, or file type).' : 'No text changes. Refresh if this file has changed.');
      return { kind: 'patch', root: status.root, entry, patch };
    } catch (error) {
      return summary(error instanceof GitFailure && error.reason === 'too-large' ? 'too-large' : 'error', error instanceof Error ? error.message : 'Could not read this file.');
    }
  }

  private async untracked(root: string, entry: GitEntry): Promise<GitDiffResult> {
    // Resolve the parent before opening, and never follow the final component.
    const parent = await realpath(dirname(join(root, entry.path)));
    const within = relative(root, parent);
    if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) return summary('error', 'This path leaves the repository.');
    let file;
    try { file = await open(join(parent, entry.path.split('/').at(-1)!), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') return summary('metadata-only', 'Untracked symbolic link — target content is not read.');
      return summary('stale', 'This file is no longer readable. Refresh to try again.');
    }
    try {
      const info = await file.stat();
      if (!info.isFile()) return summary('metadata-only', 'Only regular text files can be previewed.');
      if (info.size > DIFF_LIMIT) return summary('too-large', 'This file is too large to display (2 MiB limit).');
      const buffer = Buffer.alloc(Math.min(info.size + 1, DIFF_LIMIT + 1));
      let size = 0;
      while (size < buffer.length) { const read = await file.read(buffer, size, buffer.length - size, null); if (!read.bytesRead) break; size += read.bytesRead; }
      if (size > info.size) return summary('stale', 'This file changed during loading. Refresh to try again.');
      const content = buffer.subarray(0, size);
      if (content.includes(0)) return summary('binary', 'Binary file — text comparison is unavailable.');
      try { return { kind: 'untracked', root, entry, content: utf8.decode(content) }; }
      catch { return summary('unsupported-encoding', 'This file is not UTF-8 and cannot be displayed.'); }
    } finally { await file.close(); }
  }
}
