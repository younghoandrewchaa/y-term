# Git Diff Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review the active terminal's local Git changes in a read-only panel with aligned side-by-side diff hunks.

**Architecture:** The main process runs bounded Git reads scoped to an owned shell session. A typed preload API returns status entries and per-file patches; focused renderer modules parse patches, control refresh, and render a native HTML/CSS panel alongside the existing terminal.

**Tech Stack:** Existing Electron 42, TypeScript 6, xterm.js, esbuild, node:test, Playwright smoke scripts, and the system Git executable. No new runtime dependency.

**Spec:** [Proposed design](../specs/2026-10-27-git-diff-panel-design.md). Review and accept the design before implementation. No product code is included in this planning task.

## Global Constraints

- First version is read-only; no staging, discarding, editing, committing, or merge resolution.
- Preserve sandboxing, context isolation, CSP, terminal sessions, and current multi-window ownership rules.
- No new runtime dependency; no full-file expansion or syntax highlighting in v1.
- Five-second subprocess timeout; 4 MiB status output; 2 MiB patch/file content; 10,000 rendered rows.
- Poll only when the panel is visible and the window is focused, two seconds after the previous cycle completes.
- Use the active owned session's live directory, never an arbitrary renderer-provided directory.
- Do not commit unrelated working-tree changes, bump the version, publish, or release.

## Review Focus

- Partially staged files need different index/worktree and HEAD/index results: exercise in Task 1 fixtures and Task 5 smoke coverage.
- Spaces, newlines, leading dashes, literal pathspec characters, and rename sources must remain exact paths: exercise in Tasks 1–2.
- Tab changes, `cd`, file removal, and out-of-order responses must never show another selection's diff: exercise in Tasks 2 and 4.
- Binary/large files, conflicts, and Git errors must leave the shell usable: exercise in Tasks 1, 3, and 5.
- Resizing and expand/restore must preserve shell input and aligned diff rows at minimum width: exercise in Task 5.

## File Map

| File | Responsibility |
| --- | --- |
| `src/shared/git-protocol.ts` | Typed requests, entries, and explicit result states |
| `src/main/git.ts` | Bounded Git execution, discovery, status parsing, selected diff reads |
| `src/main/session-manager.ts` | Resolve live directory only for an owned, running session |
| `src/main/terminal-ipc.ts` | Register trusted Git read handlers beside existing handlers |
| `src/preload/index.ts`, `src/shared/terminal-protocol.ts` | Expose the two typed Git methods |
| `src/main/index.ts` | Git service lifecycle and menu action |
| `src/renderer/git-diff.ts` | Pure patch parsing and deterministic row alignment |
| `src/renderer/git-panel.ts` | Refresh/selection state, safe DOM rendering, keyboard behavior, divider |
| `src/renderer/app.ts` | Active-session, directory, theme, and menu integration |
| `src/renderer/index.html`, `src/renderer/styles.css` | Panel shell and theme/layout rules |
| `tests/git.test.ts`, `tests/git-diff.test.ts`, `tests/git-panel.test.ts` | Repository fixtures, model, and controller tests |
| `tests/session-manager.test.ts` | Session directory ownership and lifecycle tests |
| `scripts/git-smoke.ts`, `package.json`, `README.md` | Real app verification command and feature documentation |

## Task 1: Git status and selected-file reads

**Files:** Create `src/shared/git-protocol.ts`, `src/main/git.ts`, `tests/git.test.ts`.

**Interfaces:**

- Define `GitSection = 'unstaged' | 'staged'` and `GitEntry { path: string; originalPath?: string; section: GitSection; kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted' | 'submodule' | 'type-changed' | 'unsupported-path' }`.
- `GitStatusResult` is `{ kind: 'ready'; root: string; entries: GitEntry[] }` or `{ kind: 'unavailable'; reason: 'not-repository' | 'git-missing' | 'session-ended' | 'directory-unavailable' | 'too-large' | 'timeout' | 'error'; message: string }`.
- `GitDiffResult` is `{ kind: 'patch'; root: string; entry: GitEntry; patch: string }`, `{ kind: 'untracked'; root: string; entry: GitEntry; content: string }`, or `{ kind: 'summary'; reason: 'binary' | 'too-large' | 'unsupported-encoding' | 'conflict' | 'submodule' | 'metadata-only' | 'stale' | 'error'; message: string }`.
- `GitService.status(owner: number, cwd: string): Promise<GitStatusResult>` and `GitService.diff(owner: number, cwd: string, section: GitSection, path: string): Promise<GitDiffResult>`; `disposeOwner(owner: number): void` cancels its subprocesses. Service re-enumerates status to authorize selected paths; the caller owns session authorization.

- [ ] Write temporary-repository tests using the actual installed Git: clean/non-repository, nested directory, linked worktree, unborn HEAD, tracked add/modify/delete, staged rename, partial staging, untracked text, conflict, and binary. Assert the staged patch includes only staged edits and the unstaged patch includes only subsequent edits.
- [ ] Add exact-path fixtures with whitespace, newline, leading dash, and `[]*:(...)` characters. Assert selected-file requests never return another file. Cover rename NUL record ordering, symlinks, invalid UTF-8 content and filenames, metadata-only changes, timeout, and output limits. Inject the process boundary only for failures difficult to trigger deterministically.
- [ ] Run `node --experimental-strip-types --test tests/git.test.ts`; verify new behavior fails before implementation.
- [ ] Implement argument-array subprocesses, NUL status parsing, explicit result states, and bounded untracked reads. Use Git global literal pathspecs; force patch output with three context lines, no color, external diff, textconv, or user-supplied custom diff formatting. Use `--cached` for staged reads without hardcoding `HEAD` on unborn repositories. Show unsupported file summaries rather than parsing combined merge patches. Never follow untracked symlinks.
- [ ] Apply the design's resource limits, runtime validation, read-only environment/config, and owner cleanup. Preserve tracked rename metadata; parse per-file hunks without extracting paths from quoted patch headers.
- [ ] Run the Git tests and `npm run typecheck`; expect exit 0. Commit only this task's files with `feat: add bounded Git change reads`.

## Task 2: Session-scoped IPC

**Files:** Modify session manager, IPC, preload, main startup, shared terminal protocol, and session manager tests from the file map.

**Interfaces:**

- Add `SessionManager.directoryFor(owner: number, id: string): string | undefined`; authorize with `owned`, reject ended sessions, and query the live process directory rather than a renderer cache.
- Add `TerminalAPI.getGitStatus(id: string): Promise<GitStatusResult>` and `getGitDiff(id: string, section: GitSection, path: string): Promise<GitDiffResult>` mapped to `git:status` and `git:diff`.
- Pass a `GitService` instance to `registerTerminalIpc`; create it at startup and dispose its owner on window destruction and renderer-process loss.

- [ ] Add failing tests asserting foreign/closed session IDs are rejected, an exited shell cannot be read, and a fresh process directory wins over previously emitted directory events.
- [ ] Run `node --experimental-strip-types --test tests/session-manager.test.ts`; confirm failure for the missing directory interface.
- [ ] Implement the directory method and two handlers using existing trusted-frame validation. Validate argument types and section before Git execution. If live directory is unavailable, return the explicit unavailable state; do not guess a repository from preferences.
- [ ] Capture the directory at request start and recheck session ownership and directory before returning. A changed directory produces a stale diff summary or directory-unavailable status so the UI reloads; stale results never leak into another tab.
- [ ] Expose only the typed methods through preload; preserve existing APIs. Add a smoke assertion in Task 5 for foreign-window rejection and malformed arguments.
- [ ] Run session and Git tests plus typecheck; expect exit 0. Commit with `feat: expose session-scoped Git reads`.

## Task 3: Patch-to-row model

**Files:** Create `src/renderer/git-diff.ts`, `tests/git-diff.test.ts`.

**Interfaces:**

- Export `DiffRow { kind: 'context' | 'change' | 'hunk' | 'notice'; left?: { number?: number; text: string }; right?: { number?: number; text: string } }`.
- Export `buildDiffRows(diff: GitDiffResult): DiffRow[]`. Non-text results produce a notice; excessive rows produce a single size-limit notice without silently dropping content.

- [ ] Write failing tests with literal small patches: context on both sides, replacement blocks of unequal lengths, insertion-only/deletion-only hunks, multiple hunks, zero-count ranges, empty files, CRLF, and final-newline markers. Assert exact line numbers and blank cells.
- [ ] Add tests for untracked additions, malformed/combined patches, binary summaries, and more than 10,000 resulting rows. Assert source resembling HTML remains ordinary row text.
- [ ] Run `node --experimental-strip-types --test tests/git-diff.test.ts`; confirm missing-model failure.
- [ ] Implement unified-hunk parsing. For each contiguous edit block, pair removals and additions by index and pad the shorter side; do not claim semantic word alignment. Use hunk headers to reset each side's line numbers. Keep missing-final-newline annotations outside numbered source lines.
- [ ] Run model tests and typecheck; expect exit 0. Commit with `feat: align Git patch hunks for side-by-side review`.

## Task 4: Panel UI and refresh lifecycle

**Files:** Create `src/renderer/git-panel.ts`, `tests/git-panel.test.ts`; modify renderer app, markup, styles, main menu, and `MenuAction`.

**Interfaces:**

- Export `GitPanel` with constructor `(host: HTMLElement, api: Pick<TerminalAPI, 'getGitStatus' | 'getGitDiff'>, restoreTerminalFocus: () => void)`, and methods `setSession(id: string | undefined): void`, `directoryChanged(): void`, `toggle(): void`, `refresh(): Promise<void>`, `dispose(): void`.
- Keep timing/request sequencing in a DOM-independent exported `GitPanelController` in the same module, with injected API, clock/scheduler, and state-change callback. Define its state types locally; the DOM component consumes them. Tests exercise real controller decisions with deferred API responses and a controlled clock.
- Add `toggle-changes` to `MenuAction`, button `#changes-toggle`, host `#git-panel`, and the View menu shortcut `CmdOrCtrl+Shift+G`.

- [ ] Write failing controller tests for initial load, staged/unstaged selection, unchanged status with changed selected content, a stale file, and refresh coalescing. Assert late responses after rapid file/tab/directory switches never replace the current view. Assert polling stops on hidden/unfocused/disposed states and resumes on focus.
- [ ] Run `node --experimental-strip-types --test tests/git-panel.test.ts`; confirm missing-controller failure.
- [ ] Implement controller sequencing and the design's refresh triggers. Keep one cycle in flight; coalesce pending triggers, invalidate generations immediately on context changes, and schedule the next poll after completion. Main limits still bound obsolete subprocess work. Retain selection/scroll only for matching section, root, path, and unchanged content.
- [ ] Implement the Changes toolbar, file list, result states, aligned rows, comparison labels, shared scrolling, divider, expand/restore, keyboard selection, and focus restoration. Insert all repository strings with `textContent`. Render summary metadata when no text hunk exists. Use accessible names, selected states, and a restrained live status region.
- [ ] Apply the design's 1100/720/320/180/640-pixel layout rules and existing dark/light variables. Mark header controls as non-draggable. Preserve hidden terminal instances; use their existing ResizeObserver/fit behavior when layout changes.
- [ ] Wire active tab selection, successful session startup, directory callbacks, closing the active tab, window focus, beforeunload cleanup, preferences, and menu actions in `app.ts`. Leave terminal find shortcuts intact; do not send panel navigation keys to the PTY.
- [ ] Run controller/model tests and typecheck; expect exit 0. Commit with `feat: add the Git changes review panel`.

## Task 5: Real-app acceptance and documentation

**Files:** Create `scripts/git-smoke.ts`; modify `package.json` and `README.md`.

**Interfaces:** Add `test:git` script: `npm run build && node --experimental-strip-types scripts/git-smoke.ts`. Follow existing Electron smoke-test isolation through `Y_TERM_TEST_DATA`.

- [ ] Create a temporary repository and isolated app preferences pointing at it. Include two changed files, a partially staged file, an untracked file, binary data, and a large-file summary case. Test using the real Git service, not replacement IPC results.
- [ ] Verify opening via button and shortcut, selecting both motivating file paths, staged/unstaged contents, line alignment and numbers, refresh after an edit with unchanged status codes, and clean-state recovery after changes disappear.
- [ ] Verify switching repositories and `cd` while the panel is open, closing the active tab, two-window session ownership, malformed IPC input, and loading/error summaries. Confirm code resembling HTML appears as text and causes no DOM execution.
- [ ] Verify both themes and 640-, 1000-, and 1440-pixel windows. Exercise divider keyboard/pointer input, expand/restore, code copy, Escape, settings-modal precedence, and live terminal input after each layout transition. Save screenshots for visual review and inspect them before declaring completion.
- [ ] Document the Changes control, shortcut, comparison semantics, refresh behavior, limits, system Git requirement, and read-only scope in README.
- [ ] Run `npm test`, `npm run typecheck`, `npm run test:git`, existing `npm run test:e2e`, and `git diff --check`. All must exit 0; report any failure by name. `test:git` and `test:e2e` each build, so run GUI suites sequentially.
- [ ] Review the complete diff against the acceptance criteria. Confirm no repository mutation commands or unrelated changes were introduced. Commit with `test: verify Git panel workflows and document usage`.

## Delivery and deferred work

Deliver a working read-only panel plus test evidence and screenshots. Keep staging/discarding, editing, syntax highlighting, full-file expansion, commit history, and filesystem watchers as separate future decisions. If full editor behavior becomes necessary during implementation, revisit the renderer choice before adding that scope.

## Plan review

Self-reviewed against the design: each requirement maps to the five tasks; resource limits and uncommon path cases have explicit tests; interface names match across main, preload, and renderer. The user approved implementation on 2026-10-27; executed sequentially in this session.

## Verification results

- 89 unit tests, TypeScript checks, build, and `git diff --check` passed.
- `npm run test:git` passed with real Git repositories and Electron windows, including native code copying, both themes, 640/1000/1440-pixel windows, expand/restore, divider input, Find/modal precedence, tab/directory changes, clean/non-repository/exited-session states, and foreign-window rejection. Screenshots were inspected in `/private/tmp/y-term-git-screenshots`.
- Existing `npm run test:e2e` timed out in default-shell output waits at `visual-smoke.ts:35` and `smoke.ts:34`. The unchanged baseline `c6c22b4` also timed out at `smoke.ts:34` in a separate temporary checkout. The complete existing suite passed with `SHELL=/bin/bash npm run test:e2e`; no unrelated shell behavior was changed.
- Added a strict Git directory lookup alongside the existing cached file-link lookup to preserve file-link behavior. Used a new feature branch in the existing clean checkout.
