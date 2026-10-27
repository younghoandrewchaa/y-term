export type GitSection = 'unstaged' | 'staged';
export interface GitEntry {
  path: string;
  originalPath?: string;
  section: GitSection;
  kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted' | 'submodule' | 'type-changed' | 'unsupported-path';
}
export type GitStatusResult =
  | { kind: 'ready'; root: string; entries: GitEntry[] }
  | { kind: 'unavailable'; reason: 'not-repository' | 'git-missing' | 'session-ended' | 'directory-unavailable' | 'too-large' | 'timeout' | 'error'; message: string };
export type GitDiffResult =
  | { kind: 'patch'; root: string; entry: GitEntry; patch: string }
  | { kind: 'untracked'; root: string; entry: GitEntry; content: string }
  | { kind: 'summary'; reason: 'binary' | 'too-large' | 'unsupported-encoding' | 'conflict' | 'submodule' | 'metadata-only' | 'stale' | 'error'; message: string };
