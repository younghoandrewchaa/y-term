# Terminal Visual Redesign Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply the provided HTML design to Y-Term while retaining continuous terminal interaction.

**Architecture:** Restyle the existing renderer and move its existing tab controls into a session sidebar. Keep Electron, IPC, and PTY behavior intact; update xterm colours to match the chrome.

**Tech Stack:** TypeScript, CSS, Electron, xterm.js.

**Spec:** `docs/superpowers/specs/2026-10-24-visual-redesign-design.md`

## Global Constraints

- Add no dependencies or external requests.
- Preserve existing shell behavior and settings, including light theme.
- Header paths describe the configured starting directory, not tracked working directories.

## Review Focus

- Many sessions and long titles must not displace the terminal or Settings.
- The 640×400 minimum window must retain a usable terminal.
- Theme changes must cover terminal, chrome, search, and dialogs.
- The last session closing must present a usable empty state.
- Native titlebar drag regions must leave controls clickable.

### Task 1: Renderer visual redesign

**Files:** `src/renderer/index.html`, `src/renderer/styles.css`, `src/renderer/app.ts`, `src/renderer/terminal-view.ts`, `src/main/index.ts`.

- [x] Replace horizontal chrome with sidebar, titlebar, and empty state while retaining existing control IDs and accessible roles.
- [x] Adapt tab rendering and title metadata, vertical keyboard navigation, session count, and empty-state visibility.
- [x] Apply reference colours, spacing, icons, responsive layout, dialog styling, and light-theme counterparts.
- [x] Match xterm and native window backgrounds to the reference.

### Task 2: Verify layout and terminal regressions

**Files:** `scripts/smoke.ts` and validation notes in this plan.

- [x] Extend existing Electron smoke checks for sidebar geometry, active title, vertical navigation, light theme, minimum size, and empty state.
- [x] Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:e2e`; expect all to pass.
- [x] Capture and inspect screenshots; correct visible layout problems.
- [x] Review final diff and run `git diff --check`.

## Execution notes

Working in the supplied checkout so changes remain directly reviewable. This is a reversible visual update; use the existing smoke suite instead of implementation-mirroring CSS unit tests. No automatic commit or release.

Validation: 39 unit tests passed; typecheck, build, and the expanded real-Electron smoke suite passed. Inspected dark, light, settings, search, 640×400 minimum-size, overflowing session-list, and empty-state screenshots in `/private/tmp/y-term-redesign`. Native traffic lights are outside renderer screenshots. Independent static review found no important bugs; metadata changes across different session preferences and keyboard activation of close/empty-state buttons are not separately asserted by the new smoke checks.

Smoke harness corrections: synchronize screenshot readiness on real shell output rather than an assumed working directory or transient shell title; open search through the menu's IPC action because synthetic key events do not reliably invoke native macOS accelerators; direct Escape to the search field before checking that it closes.
