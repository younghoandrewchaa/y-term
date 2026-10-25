# Auto Update Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display the installed version and let users update from GitHub and restart from the sidebar.

**Architecture:** Check GitHub release metadata in the main process at startup and tab creation, with a five-minute cooldown and one request at a time. After confirmation, Electron's native macOS updater consumes a version-specific static Squirrel manifest, downloads the signed ZIP, and restarts. Publish that manifest alongside the existing signed and notarized artifacts.

**Tech Stack:** Electron 42, TypeScript, Electron Forge, node:test.

**Spec:** User's requested sidebar version, startup/tab checks, update notice/button, download/install/restart; approved with “Go ahead”.

## Global Constraints
- Retain Forge and existing signing/notarization; add no runtime dependencies.
- Support the existing macOS arm64 target; disable updates in development/tests.
- Confirm that all terminal sessions end before downloading; bypass the ordinary quit prompt only for the confirmed update restart.
- Renderer cannot select update URLs; validate IPC senders using the existing trust checks.
- No publishing or version bump in this task.

## Review Focus
- Equal/older versions, prereleases, missing assets, and foreign download URLs must never install.
- Concurrent startup/tab checks and button clicks must not duplicate requests/downloads.
- Offline/rate-limit/download errors must leave shells usable and offer retry.
- Cancelling the update must leave terminal sessions running.
- Multiple windows must show the same state and receive updates without a subscription race.

### Task 1: Release checking and native updater lifecycle
- [x] Add failing unit tests for release validation, cooldown/concurrency, confirmation, retry, disabled mode, and restart ordering.
- [x] Implement `src/main/updates.ts` with injectable fetch, native updater, confirmation, broadcast and clock boundaries.
- [x] Extend shared protocol, trusted IPC, preload and main startup/tab lifecycle; avoid a second quit confirmation on update restart.
- [x] Run updater tests and typecheck.

### Task 2: Sidebar and release artifacts
- [x] Add version/status/button to sidebar with accessible live updates and disabled busy states.
- [x] Add a tested static Squirrel manifest generator; integrate it into release upload before publication.
- [x] Add an Electron smoke check for version rendering, update notice, button/busy state and both themes without real downloads.
- [x] Update README with update behavior and signed-package validation requirements.
- [x] Run full tests, typecheck, build and relevant GUI smoke checks; review diff.

## Results
- Unit tests: 52 passed (45 existing plus seven updater tests); release test now verifies the uploaded manifest contents.
- Typecheck, build and `git diff --check`: passed.
- Updater GUI smoke: passed, including persisted themes, renderer reloads, multiple windows, download status and retry controls. Native installation is simulated.
- Quit GUI smoke: passed, including Cancel preserving working sessions.
- Full GUI smoke: passed on the final sequential run. Earlier runs timed out on shell output and search Escape; the unchanged committed baseline also passed. No product changes were made in response to those intermittent GUI failures.
- Independent code review: no critical or important findings.
- Review note: GitHub asset URLs are validated; the manifest contents remain trusted publisher output and are consumed by Squirrel, which verifies code signatures. No additional manifest parser was added.
- A real update between two signed releases remains a pre-release manual check. No release, version bump, commit or push was performed.
