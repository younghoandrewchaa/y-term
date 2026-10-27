# Local File Links Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cmd+click local file references to open their default macOS application.

**Architecture:** Add a public xterm link provider for plain paths. Route both those paths and OSC 8 file URLs through an owned-session IPC request, resolving paths in the main process and opening them with `shell.openPath`.

**Tech Stack:** TypeScript, xterm.js 5.5, Electron 42, node:test, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-27-local-file-links-design.md`

## Global Constraints

- Keep Cmd/Ctrl+click and HTTP/HTTPS behaviour intact.
- Resolve relative paths from the clicked session's current directory.
- Use the default macOS app; add no editor settings or preview UI.
- Report errors in the existing status display; never execute link text as shell input.

## Review Focus

- Wrapped paths and wide/combined Unicode cells must retain correct click ranges.
- Quotes and Markdown punctuation must not become part of a path.
- File URLs must reject remote hosts, other protocols, and malformed encoding.
- Relative resolution must respect directory changes and session ownership.
- Ordinary clicks must not launch an application; native opening errors must surface.

### Task 1: Resolve and open owned-session file links

**Files:** `src/main/file-links.ts`, `src/main/session-manager.ts`, `src/main/terminal-ipc.ts`, `src/shared/terminal-protocol.ts`, `src/preload/index.ts`, `tests/file-links.test.ts`, `tests/session-manager.test.ts`.

**Interfaces:** `resolveFileLink(value: unknown, cwd: string | undefined, home: string): string`; `SessionManager.directory(owner: number, id: string): string | undefined`; `TerminalAPI.openFile(id: string, value: string): Promise<void>`.

- [x] Write tests for relative/absolute/home paths, line suffixes, encoded local file URLs, invalid inputs, missing files, and owned-session live directory lookup.
- [x] Run the new tests and confirm failure before implementation.
- [x] Implement path resolution, file existence checking, session ownership, IPC and preload bindings. Open files with `shell.openPath`; surface its error string.
- [x] Run unit tests and typecheck.

### Task 2: Detect terminal paths and activate links

**Files:** `src/renderer/file-links.ts`, `src/renderer/terminal-view.ts`, `tests/terminal-file-links.test.ts`, `scripts/link-smoke.ts`.

**Interfaces:** `createFileLinkProvider(terminal: Pick<Terminal, 'buffer' | 'cols'>, activate: (event: MouseEvent, path: string) => void): ILinkProvider`.

- [x] Write failing tests for the example Codex sentence, quoted paths, punctuation, wrapped paths, Unicode coordinates, and excluding web URLs.
- [x] Implement a bounded wrapped-line scan using public buffer cell APIs and register the provider. Dispatch OSC 8 file URLs to the same file-opening route.
- [x] Extend the real Electron smoke test to intercept `shell.openPath`, check resolved paths, modifier gating, and opening failures while retaining web assertions.
- [x] Run unit tests, typecheck, build, Electron smoke checks, and `git diff --check`.
- [x] Review the complete diff and record verification results before finishing.

## Execution record

Implemented on `feat/local-file-links` in the existing checkout. No dependencies added.

- Baseline: 59 unit tests passed.
- Task 1: new path-resolution and owned-session directory tests failed before implementation, then passed.
- Task 2: tests against actual xterm buffers failed before implementation, then passed; Electron checks intercept the native opener to verify resolved file paths without launching another app.
- Review fixes: apostrophes in prose no longer consume file references; encoded colons in file URLs are preserved; live directory lookup delivers directory events so the displayed directory does not become stale. Each fix has a regression observed failing before the correction and passing afterward.
- Final verification: 69/69 unit tests, TypeScript typecheck, build, and `git diff --check` passed. The full Electron smoke suite passed with `ZDOTDIR=/private/tmp`; runs using the normal shell configuration encountered intermittent startup/command timeouts.
- Existing web link checks and new relative, quoted, wrapped absolute, OSC 8 file URL, modifier gating, and native-opening error checks all passed.
- Review limits: plain paths containing spaces must be quoted; logical lines spanning more than 64 terminal rows are skipped to bound scanning work.
