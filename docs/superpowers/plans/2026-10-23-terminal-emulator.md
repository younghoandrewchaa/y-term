# Y-Term: macOS Terminal Emulator Plan

Status: core implementation and local automated validation complete. Typecheck/build, 21 unit tests, two real-PTY integration tests, Apple Silicon packaging/ZIP, and packaged native-PTY loading pass. The user reports the packaged GUI smoke test passes from their normal terminal. Manual acceptance, signing/notarization, and second-Mac validation remain pending. See implementation-progress.md for evidence.

**Goal:** Build a reliable macOS desktop terminal using Electron, xterm.js, and a real local shell.

**Confirmed requirements:** Electron, xterm.js, macOS first.

**Proposed defaults:** TypeScript, a plain TypeScript renderer, Electron Forge for development and distribution, and node-pty for shell sessions. Start with Apple Silicon; add Intel builds if needed. These are recommendations, not confirmed requirements. Resolve and pin compatible stable dependency versions during setup.

## Scope

The first release opens an interactive local shell, supports tabs, resizes correctly, offers copy/paste and terminal search, and saves basic preferences. It should work when launched from Finder as well as from a development shell.

Defer split panes, dedicated SSH/SFTP management, plugins, cloud sync, AI features, persistent processes across app restarts, and automatic updates. Users can still run their installed ssh client inside the terminal.

## Approach

Two reasonable renderer options are plain TypeScript and React. Plain TypeScript keeps this small initial interface simple; React becomes attractive if the app grows a complex workspace interface. This plan recommends plain TypeScript and keeps terminal/session logic independent of the UI framework.

Use Electron IPC between the renderer and shell host. A local WebSocket server adds an unnecessary server lifecycle and authentication boundary for this desktop-only version.

Architecture:

```text
Renderer: tab UI + one xterm.js instance per session
    ↕ narrow, typed preload API
Electron main: IPC validation + session ownership + node-pty
    ↕ pseudoterminal
User's local shell and child programs
```

xterm.js handles display and terminal input; node-pty creates the pseudoterminal needed by interactive shells and full-screen programs. Keep node-pty outside the renderer. A separate PTY host process can be considered later if profiling or crash isolation warrants it.

## Suggested file layout

```text
src/
  main/
    index.ts              Window and app lifecycle
    terminal-ipc.ts       Validate requests and enforce session ownership
    session-manager.ts    Spawn, write, resize, terminate, and clean up PTYs
    shell.ts              Resolve shell, home directory, and launch environment
    preferences.ts        Validate and persist settings
  preload/
    index.ts              Expose only the supported terminal API
  shared/
    terminal-protocol.ts  IPC request/event types
  renderer/
    index.html
    app.ts                Tabs, focus, keyboard shortcuts, and settings UI
    terminal-view.ts      xterm.js lifecycle, fitting, and data flow
    styles.css
tests/
  session-manager.test.ts
  terminal-ipc.test.ts
  preferences.test.ts
  terminal.e2e.ts
```

Checklist marks completed implementation and recorded validation; the acceptance paragraphs also require the remaining manual checks.

## Milestone 1: Packaged single-shell prototype

- [x] Scaffold Electron Forge with TypeScript and a renderer build pipeline. Add xterm.js, its CSS, the fit addon, and node-pty.
- [x] Configure the native module rebuild and packaging rules for node-pty. Test the packaged executable immediately; successful development startup alone is insufficient.
- [x] Open a sandboxed renderer with context isolation enabled and Node integration disabled. Expose explicit create, write, resize, close, and event-subscription methods through preload.
- [ ] Create a PTY using the user's configured shell, falling back to `/bin/zsh`; start in the user's home directory. Define login-shell behavior and check PATH when launched from Finder.
- [x] Connect input to PTY writes and PTY output to xterm.js. Register output listeners before starting the session, or buffer startup output until the renderer is ready.
- [x] Fit the terminal once its container and fonts are ready, and propagate valid column/row changes to the PTY.

**Acceptance:** A packaged app launched from Finder opens a shell, accepts commands, displays colours, handles Ctrl-C, runs a full-screen program, and resizes without corrupting its layout. Confirm installed command-line tools remain discoverable.

## Milestone 2: Reliable session lifecycle and transport

- [x] Assign each session an ID and owning window. Validate the IPC sender, session ownership, payload types, and resize bounds. Expose neither raw ipcRenderer nor a general-purpose Node API.
- [x] Subscribe to both ordinary input and xterm.js binary-input events where applicable; preserve the required data encoding.
- [x] Add bounded output buffering and acknowledgement-based flow control. Acknowledge output after xterm.js processes it and pause/resume PTY output at high/low watermarks.
- [x] Distinguish natural shell exit from user-requested closure. Show the exit status and offer a fresh session after an unexpected exit.
- [x] Dispose subscriptions and xterm.js instances, terminate owned PTYs on tab/window closure, and clean up on renderer failure. Verify foreground child programs exit too.
- [x] Unit-test routing, rejected cross-window requests, invalid dimensions, startup failures, exit races, and repeated close requests using a fake PTY. Add real-PTY integration coverage.

**Acceptance:** Sustained high-volume output stays responsive with bounded queues. Closing or crashing a window leaves no owned shell sessions behind. Input for a closed session cannot reach another session.

## Milestone 3: Everyday terminal controls

- [x] Add independent tabs: new, select, close, and keyboard navigation. Keep inactive terminal instances mounted and their sessions running; refit on activation.
- [x] Add macOS shortcuts for new/close tab, copy/paste, find, and font zoom. Preserve terminal control-key behavior.
- [x] Support selection, scrolling, clear display, and search using the xterm.js search addon.
- [x] Add link detection only with deliberate user activation and an explicit HTTP/HTTPS allowlist before opening the system browser. Treat terminal titles and output as untrusted text.
- [ ] Check multiline paste behavior, non-US keyboard layouts, composition input, Unicode, emoji, and wide characters.

**Acceptance:** Two tabs retain separate working directories and foreground programs. Switching tabs preserves output, selection/focus behavior is predictable, and copy/paste works with keyboard shortcuts and the macOS menu.

## Milestone 4: Preferences and desktop behaviour

- [x] Persist font family/size, theme, scrollback limit, shell executable, initial directory, and window bounds in Electron's user-data directory.
- [x] Validate saved preferences; recover with defaults if the file is missing or corrupt. Use atomic writes. Do not persist terminal output or credentials by default.
- [x] Restore window bounds onto an available display. Implement macOS menu, About, Quit, and Dock activation behaviour.
- [x] Explain that reopened tabs create new shells; live processes are not restored after quitting.
- [x] Add a clear error screen for invalid shell paths or inaccessible starting directories.

**Acceptance:** Settings survive relaunch, invalid settings recover safely, and removing an external monitor does not make the window inaccessible.

## Milestone 5: Release validation and distribution

- [x] Add automated Electron smoke tests for opening a shell, executing a command, resizing, multiple tabs, and session closure. Run actual PTY tests on macOS.
- [ ] Manually verify zsh, bash, vim or nano, less, top, Ctrl-C, Ctrl-D, Unicode, and large output in the packaged application.
- [ ] Enforce a production Content Security Policy, block unexpected navigation/popups, and test that terminal output cannot call privileged APIs or open arbitrary URL schemes.
- [ ] Build an Apple Silicon distribution and verify native module loading on a clean machine. Add an Intel build and separate validation if Intel support is selected.
- [ ] For public distribution, configure Developer ID signing and notarization using release credentials, then verify the downloaded artifact passes macOS launch checks.
- [x] Document development commands, packaging, supported architecture, known limitations, and third-party notices.

**Acceptance:** The distributable installs and launches on another supported Mac, opens a working shell without developer tooling, and passes the terminal/session checks above.

## Main risks and priorities

1. Native node-pty compatibility and packaging: prove the packaged build in milestone 1.
2. Finder shell environment: test GUI launch early, especially PATH and shell startup files.
3. Output flooding: implement flow control before considering the app ready for daily use.
4. Orphan processes and event races: make lifecycle behaviour explicit and test it.
5. Privileged IPC: keep the interface narrow and validate every request in the main process.

Commit after each independently working milestone. Select test tools and exact dependency versions during scaffolding, recording the commands in the README. No time estimate is committed because release polish, architecture coverage, and signing requirements remain open.

## References

- [xterm.js overview, installation, PTY integration, and addons](https://github.com/xtermjs/xterm.js/)
- [node-pty](https://github.com/microsoft/node-pty)
- [xterm.js flow control](https://xtermjs.org/docs/guides/flowcontrol/)
- [Electron security recommendations](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron native modules and rebuilds](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
