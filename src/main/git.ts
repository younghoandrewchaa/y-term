import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

export type GitSection = 'unstaged' | 'staged';
export interface GitEntry {
  path: string;
  originalPath?: string;
  section: GitSection;
  kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted' | 'submodule' | 'type-changed' | 'unsupported-path';
}

const STATUS_LIMIT = 4 * 1024 * 1024;
const BASELINE_LIMIT = 16 * 1024 * 1024;
const conflicts = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
type FailureReason = 'not-repository' | 'git-missing' | 'too-large' | 'timeout' | 'error';
class GitFailure extends Error {
  readonly reason: FailureReason;
  constructor(reason: FailureReason, message: string) { super(message); this.reason = reason; }
}
/** The version a changed file is compared with: the index for unstaged changes, HEAD for staged-only changes. */
export interface GitBaseline { label: 'HEAD' | 'Staged'; content: Buffer }

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
      const timer = setTimeout(() => stop('timeout', 'Git took too long.'), this.options.timeout ?? 5000);
      child.stdout.on('data', (data: Buffer) => {
        bytes += data.length;
        if (bytes > limit) stop('too-large', 'This file is too large to compare.');
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
          reject(new GitFailure(/not a git repository/i.test(error) ? 'not-repository' : 'error', /not a git repository/i.test(error) ? 'This file is outside a Git repository.' : `Could not read this file from Git. ${error.slice(0, 500).trim()}`));
        } else resolve(Buffer.concat(output));
      });
    });
  }

  /** Finds the one tracked or unignored file below `cwd` whose path ends with `suffix`; undefined if none or several match. */
  async locate(owner: number, cwd: string, suffix: string): Promise<string | undefined> {
    let output: Buffer;
    try { output = await this.run(owner, cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], BASELINE_LIMIT); }
    catch (error) { if (error instanceof GitFailure && error.reason === 'not-repository') return undefined; throw error; }
    const matches = new Set<string>();
    for (const path of output.toString('utf8').split('\0')) {
      if (path === suffix || path.endsWith(`/${suffix}`)) matches.add(path);
    }
    return matches.size === 1 ? join(cwd, [...matches][0]) : undefined;
  }

  /** Returns undefined for files that are unchanged, untracked, conflicted, newly added, or outside a repository. */
  async baseline(owner: number, file: string): Promise<GitBaseline | undefined> {
    if (!isAbsolute(file)) return undefined;
    // Resolve the parent so the path matches Git's view, but never follow the file itself.
    const parent = await realpath(dirname(file));
    let root: string;
    try { root = await realpath(utf8.decode(await this.run(owner, parent, ['rev-parse', '--show-toplevel'], STATUS_LIMIT)).replace(/\n$/, '')); }
    catch (error) { if (error instanceof GitFailure && error.reason === 'not-repository') return undefined; throw error; }
    const path = relative(root, join(parent, basename(file)));
    if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) return undefined;
    // Read the whole repository: a path-limited status cannot detect that the file was renamed.
    const output = await this.run(owner, root, ['status', '--porcelain=v1', '-z', '--untracked-files=no'], this.options.statusLimit ?? STATUS_LIMIT);
    const entries = parseGitStatus(output).filter(entry => entry.path === path);
    const entry = (section: GitSection) => entries.find(item => item.section === section);
    const unstaged = entry('unstaged'), staged = entry('staged');
    let object: string;
    if (unstaged) {
      if (unstaged.kind !== 'modified' && unstaged.kind !== 'type-changed') return undefined;
      // Stage 0 explicitly: a path such as "1:file" would otherwise name a merge stage.
      object = `:0:${path}`;
    } else if (staged && (staged.kind === 'modified' || staged.kind === 'type-changed')) object = `HEAD:${path}`;
    else if (staged?.kind === 'renamed' && staged.originalPath !== undefined) object = `HEAD:${staged.originalPath}`;
    else return undefined;
    // Filters apply the same line-ending and smudge conversion as a checkout.
    const content = await this.run(owner, root, ['cat-file', '--filters', object], BASELINE_LIMIT);
    return { label: unstaged && staged ? 'Staged' : 'HEAD', content };
  }
}
