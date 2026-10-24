# File and Folder Drop Paths Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. This document is a proposed plan; implementation has not been requested.

**Goal:** Drop files or folders from Finder into a terminal and insert their absolute paths at the input cursor.

**Architecture:** Resolve native `File` paths through a narrow preload method, format the paths as shell arguments in a pure renderer helper, and paste them through the receiving `TerminalView`. Keep the existing PTY write channel and Electron security settings.

**Tech Stack:** Electron 42.3.0, xterm.js 5.5.0, TypeScript, Node's test runner, existing Playwright Electron smoke harness.

**Spec:** The proposed behavior below captures the user's request and explicitly identifies implementation assumptions.

## Proposed behavior and constraints

- Dropping one file or folder inserts its absolute path into the terminal receiving the drop. A folder is one argument; do not enumerate its contents.
- Multiple items produce individually quoted arguments, in drop order, separated by one space, with one trailing space for the next argument. Do not prepend a space: a user can type `cat ` or `cd ` before dropping.
- Always single-quote each path; encode an embedded apostrophe by closing the quote, escaping the apostrophe, and reopening it. Preserve spaces, Unicode, backslashes, dollar signs, backticks, and shell operators literally. Verify this encoding with zsh and bash; include fish in manual acceptance when installed.
- Do not append Enter, run a command, change directories, open a file, upload it, or start a new tab. Insert using `terminal.paste()`, preserving xterm's bracketed-paste behavior.
- Accept native disk-backed files and directories only. Never infer a native path from `File.name`, dropped text, a URL, or the removed `File.path` property.
- Reject the entire batch if any path is empty, not absolute, or contains C0 controls (`U+0000`–`U+001F`) or DEL (`U+007F`). Show a brief status message and insert nothing. This includes filenames containing tabs or newlines.
- Drops before the session starts, after it exits, after disposal, or while a modal is open insert nothing. Do not queue input for another session. Focus the receiving terminal after a successful drop.
- Prevent file-drop navigation throughout the app; only a visible, live terminal host accepts input. Leave ordinary text drag behavior alone.
- No dependencies, main-process filesystem operations, permission dialogs, settings, or drag overlay are needed.

These are proposed defaults, particularly quoting, multiple items, trailing space, and control-character rejection. Custom shells may use different quoting rules; support the app's existing Unix shell use rather than claiming universal command-language support.

## Approaches considered

1. **Recommended: preload path lookup + renderer drop handling.** Fits the isolated renderer and existing terminal paste path, without a new IPC handler.
2. **Move path resolution/formatting through main-process IPC.** Adds an unnecessary round trip and API surface; main is not needed to obtain these paths.
3. **Use dropped text or `File.path`.** Text cannot reliably distinguish native absolute paths, and Electron removed `File.path` in version 32.

Reference: [Electron webUtils documentation](https://github.com/electron/electron/blob/main/docs/api/web-utils.md), fetched using Context7. The installed Electron declaration also defines `getPathForFile(file: File): string`; the installed xterm declaration defines `paste(data: string): void`. Context7 did not offer the installed Electron version, so check the installed API and real application during implementation.

## File responsibilities

| File | Change |
| --- | --- |
| `src/shared/terminal-protocol.ts` | Add `TerminalAPI.getPathForFile(file: File): string`. |
| `src/preload/index.ts` | Expose only a wrapper around `webUtils.getPathForFile`. |
| `src/renderer/file-drop.ts` (new) | Validate/quote paths and attach removable host drop listeners. |
| `src/renderer/terminal-view.ts` | Supply session availability, path lookup, paste, focus, and status callbacks; dispose drop listeners. |
| `src/renderer/app.ts` | Prevent default file navigation on drops outside terminal hosts. |
| `tests/file-drop.test.ts` (new) | Exercise formatting and event-handler routing with injected callbacks. |
| `scripts/smoke.ts` | Exercise the real preload bridge and native disk-backed drop input. |
| `README.md` | Describe drag-and-drop usage and limitations. |

## Review focus

1. Shell metacharacters must remain literal, including embedded apostrophes and backslashes.
2. Finder folders must yield a single absolute path without reading contents.
3. A rejected item in a mixed batch must prevent partial insertion.
4. Nested xterm elements must not cause duplicate paste, wrong-tab input, or file navigation.
5. Starting/exited/closed sessions and open dialogs must never receive deferred input.

## Task 1: Resolve and format native paths

**Files:** Modify `src/shared/terminal-protocol.ts`, `src/preload/index.ts`; create `src/renderer/file-drop.ts`, `tests/file-drop.test.ts`.

**Interfaces:** Expose `TerminalAPI.getPathForFile(file: File): string` synchronously. Export `formatDroppedPaths(paths: readonly string[]): string` from `file-drop.ts`; return `''` for an empty batch and throw a user-readable error for any invalid path.

- [ ] Add unit tests for a simple file, directory, multiple paths, spaces, Unicode, apostrophes, backslashes, `$()`, backticks, semicolons, wildcards, and preserved order. Assert `formatDroppedPaths(['/tmp/a', '/tmp/b'])` is `"'/tmp/a' '/tmp/b' "`.
- [ ] Add assertions that empty input returns `''`; relative paths, empty paths, NUL, tab, CR, LF, escape, and DEL throw. A batch with one valid and one invalid path must throw rather than return partial text.
- [ ] Run `node --experimental-strip-types --test tests/file-drop.test.ts`; confirm failure because the formatter is absent.
- [ ] Implement validation and Unix single-quote formatting. Add the typed bridge method using `webUtils` imported from Electron in preload. Return the native API result; let invalid File errors reach the caller's catch handler. Do not expose Electron objects or add an IPC channel.
- [ ] Run the focused test and `npm run typecheck`; require both to pass. Check existing typed API fixtures for necessary updates.
- [ ] Commit as `feat: resolve and quote dropped file paths`.

## Task 2: Route drops into the receiving terminal

**Files:** Modify `src/renderer/file-drop.ts`, `src/renderer/terminal-view.ts`, `src/renderer/app.ts`, `tests/file-drop.test.ts`.

**Interfaces:** Export `attachTerminalFileDrop(host: HTMLElement, callbacks: FileDropCallbacks): () => void`. Define `FileDropCallbacks` in the same module with `canPaste(): boolean`, `getPathForFile(file: File): string`, `paste(text: string): void`, `focus(): void`, and `report(message: string): void`. The returned function removes all listeners.

- [ ] Add handler tests using an `EventTarget`-based host fixture and injected callbacks. Cover `dragover` with `types: ['Files']` but an empty protected `files` list, native-file drops, folders represented as one File, multiple files, and events originating at a nested terminal element. Assert file events prevent default and a valid drop calls paste/focus exactly once.
- [ ] Cover text-only drags (no interception), lookup returning `''`, lookup throwing, invalid mixed batches, `canPaste() === false`, and invocation after listener cleanup. Assert rejected drops never call paste; path failures call report without an uncaught exception.
- [ ] Run the focused test; confirm the new handler tests fail before implementation.
- [ ] Implement capture-phase host `dragover`/`drop` listeners to intercept file drags before xterm can handle them. Resolve the FileList synchronously, format the entire batch, recheck availability, paste once, and focus. Catch resolution/validation failures and report them. Use `types` to recognize Files during dragover, and the actual FileList during drop; directories need no content traversal.
- [ ] Integrate with `TerminalView`: store the cleanup callback; set a local session-exited flag in its existing `exited` callback; make availability require a session ID, no exit/disposal, a visible panel, and no `dialog[open]`. Pass `terminal.paste`, `terminal.focus`, the preload resolver, and the existing status callback. Remove listeners in `close()`.
- [ ] In `app.ts`, add bubbling document `dragover`/`drop` guards that only prevent default for file drags. They must not resolve paths or insert text. This catches drops on tabs, settings, or empty app areas without interfering with host handlers.
- [ ] Run `npm test` and `npm run typecheck`; require passing results. Review that each host owns its own callback closures and no async path-resolution race exists.
- [ ] Commit as `feat: paste file and folder drops into terminal input`.

## Task 3: Verify the bridge and real shell behavior

**Files:** Modify `scripts/smoke.ts`, `README.md`.

**Interfaces:** Use Task 1's bridge and Task 2's terminal host events. Keep fixtures in the smoke harness's existing temporary directory and clean them up in its `finally` block.

- [ ] Extend the smoke harness with real file and directory fixtures, including spaces, Unicode, an apostrophe, and shell metacharacters. Obtain disk-backed Files via Playwright's file-input support in the Electron renderer, then build a DataTransfer and dispatch dragover/drop onto a nested element of the active terminal. Do not replace the production path resolver or use `new File()` as evidence of native path resolution.
- [ ] Assert the real bridge returns the fixture's absolute path; assert a JS-created `new File()` returns `''`. First run `npm run test:e2e` against the current behavior and confirm the new drop assertions fail. GUI commands require execution outside the sandbox.
- [ ] After Tasks 1–2, assert a drop alone produces no command-result marker before Enter; after explicit Enter, a command that prints its arguments receives the exact original paths and argument count. Include a second tab and assert the inactive shell receives nothing. Check `pageerror` remains empty and the page URL is unchanged.
- [ ] Keep native Finder acceptance separate: synthesized events cannot prove macOS directory delivery. In the running app, drop a Finder file, folder, mixed selection, and a folder containing files; verify only selected paths appear, exactly once. Check a typed `cd ` prefix, drop outside the terminal, an exited tab, open settings, tab closure, and ordinary text/clipboard paste.
- [ ] Exercise the quoting fixtures in zsh and bash; try fish if installed. Check bracketed paste inside an editor. If native folder drops expose a platform-specific limitation, resolve it before declaring folder support complete.
- [ ] Add a README Use bullet describing file/folder drops, multiple items, quoted absolute paths, no automatic execution, and control-character rejection.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:e2e`; require success. Record any environment blocker and exact remaining manual checks rather than claiming they passed. No packaging/release is required for this feature plan.
- [ ] Commit as `test: verify native file drop paths and document usage`.

## Completion criteria

A real Finder file or folder lands as a usable quoted argument in the receiving live terminal; multiple selections preserve their paths and order. Enter remains a separate user action. Path lookup works through the real isolated preload bridge, ordinary input still works, and the automated checks plus native Finder acceptance above have recorded results.
