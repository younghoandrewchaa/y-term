# Execution ledger — 2026-10-23-terminal-emulator.md

- User approved the plan with “Go ahead”. Executing inline.
- Ruling: work in the provided directory because it is a new project without a Git repository; no existing branch or worktree exists to protect.
- Ruling: use esbuild with Electron Forge rather than the experimental Forge Vite plugin; this app does not require a development server and can use a stricter CSP in development and production.
- Dependency access: Context7 is not cached and npm registry DNS failed in the planning turn. Official documentation checked for Electron contextBridge, native module packaging, and xterm.js flow control. Dependency installation and packaged testing remain to be verified.
- Public release signing and notarization require the user's Apple Developer credentials and a second Mac is needed for clean-machine verification. Configure optional signing without publishing or accessing credentials.

## Resumed 2026-10-23

- Baseline: 16/16 unit tests pass with Node 24.13.0 selected explicitly (the default Volta shim has no Node configured).
- Continue in the supplied non-Git directory, preserving the previous executor's ruling. No commits or worktree scripts are possible without a repository.
- Pre-flight: main → preload → renderer agree on IDs, ready handshake, exact sequence acknowledgements, menu actions, and preference schema. The renderer must subscribe before create and acknowledge only in xterm write callbacks.
- Ruling: the plan is a milestone checklist rather than numbered task briefs; retain this existing tracked ledger rather than generate Git-based task briefs that cannot run here. Cost if wrong: less granular execution history, with verification recorded here instead.
- Renderer transport: added tests first; confirmed missing-module failure, then 19/19 tests pass. Covers delayed output acknowledgement, cross-session routing, late creation after tab closure, exit status, and subscription cleanup.
- Dependency install and Context7 were attempted again. registry.npmjs.org DNS is unavailable in this sandbox. Sandbox escalation is disabled by this session's permissions; cannot retry outside it. Build, typecheck, actual PTY and packaged Electron verification remain pending dependency access.
- Renderer source now includes mounted independent tabs, fitting, UTF-8/binary input, delayed acknowledgements, natural exit/error screens, fresh-shell action, search, explicit modified-click links, multiline paste confirmation, theme/font/scrollback/settings, and menu handling. UI acceptance remains unverified.
- Added a development/packaged smoke runner and README with setup, packaging, manual acceptance, release credentials, limitations, and notice inventory. The smoke runner checks displayed shell output, stty size changes, tab commands, child-process termination, and URL rejection; it has not run past build.
- Context7 failed with ENOTFOUND; no successful Context7 documentation fetch was possible. Official xterm Terminal API and Playwright Electron documentation were read through the web tool; node-pty pinned source was checked during review. No silent fallback to recalled library documentation.
- Fresh-context review identified binary byte corruption, creation-time resize loss, incomplete hangup-only process cleanup, and inadequate smoke assertions.
- Final: fixed binary corruption — routing regression asserted Buffer([0x80]) RED→GREEN; suite 19/19.
- Final: fixed creation-time resize loss — pending-create resize regression RED→GREEN; suite 21/21.
- Final: fixed hangup-only child cleanup — regression verifies forceful descendant termination and skipping changed process identities RED→GREEN; suite 21/21. OS calls are mocked because process enumeration is blocked in this sandbox. Real child-process cleanup is still pending packaged smoke verification.
- Ruling: tab/window closure forcefully ends the shell and its current descendants, rechecking recorded process start identities before signalling. This enforces closure even for programs ignoring hangup and works during quit without timers. Cost if wrong: applications lose their opportunity to save/clean up on closure; detached/reparented processes and OS-level identity races are not fully contained by a process snapshot.
- Final: strengthened smoke assertions for rendered output, actual PTY size changes, and foreground process termination. RED remains environmental (esbuild missing); no GREEN claim for smoke tests.
- Verification: npm test → 21 passed, 0 failed. Node strip-types syntax checks for renderer and smoke source pass. npm run typecheck → tsc unavailable; npm run test:e2e and npm run package → esbuild unavailable. Offline install also fails ENOTCACHED. No release artifact, signing, or clean-machine verification has occurred.
- No commits were created because this workspace has no .git directory. Plan milestone acceptance boxes remain unchecked until the relevant runtime checks can actually pass.
- User requested another installation attempt. Retried using installed Node 24, writable /private/tmp/y-term-npm-cache, bounded fetch timeout/retries. Registry requests for @xterm/addon-fit, addon-search, and addon-web-links again failed ENOTFOUND; cancelled remaining repeated requests. Node/cache configuration is no longer the cause; registry DNS access remains unavailable in this session.

## Dependency installation and native/package validation

- User installed dependencies successfully outside the agent session; package-lock.json now records the installed versions.
- npm run typecheck initially found TS2882 for stylesheet imports. Added renderer/assets.d.ts declaring CSS imports; typecheck now passes. npm run build passes; 21/21 unit tests still pass.
- GUI smoke attempts failed before application JavaScript. User-supplied crash report matches the last automated PID 35261 exactly (21:27:03), with SIGABRT in HIServices _RegisterApplication → NSApplication. Debug output also reports kill EPERM. Stopped all GUI launch attempts. Electron issue https://github.com/electron/electron/issues/52815 documents this pre-JavaScript Launch Services failure under sandbox restrictions. GUI smoke must run from a normal terminal; do not retry GUI launches from this sandbox.
- Electron Node-only mode works without GUI registration. Added npm run test:pty: actual zsh and bash sessions pass Unicode, 101×37 resizing checked via stty, 50,000-line sustained output, and post-close input rejection through SessionManager (2/2 integration tests).
- Forge's first package attempt failed fetching github.com. Added optional ELECTRON_ZIP_DIR support, backed by the installed Packager's documented electronZipDir option; pointed it at the existing matching Electron 42.3.0 Apple Silicon archive in the local cache. No network or permissions override was used.
- npm run package with ELECTRON_ZIP_DIR passes. Verified unpacked pty.node and executable spawn-helper exist; ran the packaged executable in Node-only mode, loaded node-pty through app.asar, and successfully executed a real zsh command (YTERM_PACKAGED_OK).
- npm run make with the same cached archive passes and creates an unsigned Apple Silicon ZIP under out/make.
- GUI rendering, full UI smoke, Finder launch/PATH, real foreground process cleanup, manual terminal/keyboard checks, signing/notarization, and clean-machine acceptance are still pending. No further GUI launch was attempted after the user supplied the crash report.

## Packaged GUI validation reported by user

- User reports “It all pass” after being asked to run npm run test:packaged from a normal terminal. Recorded as user-reported success, not an agent-observed run. This covers the smoke script's rendered shell output, actual PTY resizing, independent tab commands, foreground child termination on tab closure, and disallowed URL rejection.
- Core implementation and local automated validation are complete. Updated the plan's implementation checklist and README. Manual Finder/PATH, full-screen programs/control keys, keyboard/IME/paste, preference/display relaunch checks, security acceptance beyond existing automated tests, signing/notarization, and second-Mac testing remain open.
- No GUI launch was retried from the agent sandbox and no Git commits were possible in this non-repository workspace.
