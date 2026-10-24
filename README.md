# Y-Term

A macOS terminal built with Electron, xterm.js, and local pseudoterminals. The initial distribution target is Apple Silicon.

## Develop

Use Node.js 24.13 or later, npm, and Apple's Xcode Command Line Tools (`xcode-select --install`). Native dependency installation needs access to the npm registry and Electron downloads.

```sh
npm install
npm test
npm run typecheck
npm start
```

`npm install` rebuilds node-pty for Electron. After changing Electron or native dependencies, run `npm run rebuild`. The renderer is compiled with esbuild and loaded locally without a development server. Restart `npm start` after editing source.

## Use

- ⌘T creates a tab; ⌘W closes the current tab and immediately terminates its shell and child programs. Control-Tab and Control-Shift-Tab switch tabs.
- ⌘C and ⌘V copy and paste using the macOS Edit menu. Control-C remains the shell interrupt key. Multiline paste asks for confirmation.
- ⌘F searches the active terminal; Enter and Shift-Enter move between matches; Escape closes search.
- ⌘+ / ⌘− change font size, ⌘0 resets it, and ⌘K clears the display.
- ⌘-click or Control-click activates HTTP/HTTPS links. Other URL schemes are rejected by the main process.
- ⌘, opens settings. Font, theme, and scrollback apply immediately. Shell and initial directory changes apply to new tabs.

Settings and window placement are stored in `preferences.json` inside Electron's macOS user-data directory (`~/Library/Application Support/Y-Term`). Invalid or corrupt files recover with defaults. Terminal output and credentials are not saved. Quitting ends shells; reopening creates fresh ones.

Known shells start interactively as login shells. Finder launch therefore uses the shell's login configuration for PATH, including macOS `/etc/zprofile`. Custom shell startup files can still replace PATH or fail; verify installed tools from a Finder launch.

## Validate and package

```sh
npm test
npm run typecheck
npm run test:pty
npm run test:e2e
npm run package
npm run test:packaged
npm run make
```

The smoke test launches real Electron and real PTYs using a temporary settings directory. It executes shell commands, resizes the window, switches and closes independent tabs, and checks URL restrictions. `test:packaged` runs the same checks against `out/Y-Term-darwin-arm64/Y-Term.app/Contents/MacOS/Y-Term`. Packaging unpacks node-pty so its native binding and spawn helper remain accessible. `npm run make` creates a ZIP and a DMG in `out/make`.

Automated checks supplement these manual packaged-app checks:

- Open the app from Finder with a minimal inherited PATH; run `command -v` for installed tools.
- Exercise zsh and bash, vim or nano, less, top, Ctrl-C, Ctrl-D, window resizing, and scrolling.
- Confirm independent tab working directories and foreground programs; close a tab/window during a foreground child process and check it exits.
- Run sustained high output, switch tabs while it runs, and confirm responsiveness and eventual completion.
- Check Unicode, emoji, wide characters, composition input, non-US keyboard layouts, selection, and multiline paste.
- Relaunch after changing settings and after disconnecting an external display.
- Test the distributable on a second Apple Silicon Mac without developer tooling.

Verified in this workspace: typecheck, build, 21 unit tests, two real-PTY integration tests (zsh/bash, Unicode, resize, sustained output), Apple Silicon packaging/ZIP creation, and native PTY loading from the packaged ASAR. The user also reports `npm run test:packaged` passes from their normal terminal, covering displayed output, PTY resizing, tab switching, foreground process cleanup, and URL rejection. Manual acceptance remains pending. Launching GUI Electron from the agent sandbox aborts during macOS Launch Services registration before app code runs; run GUI smoke tests from a normal local terminal. See the [execution ledger](docs/superpowers/plans/implementation-progress.md) for exact results.

For offline packaging with an already downloaded Electron archive, set `ELECTRON_ZIP_DIR` to the directory containing `electron-v42.3.0-darwin-arm64.zip` before running `npm run package` or `npm run make`.

## Public release

From a clean, committed checkout on macOS, authenticate the GitHub CLI with `gh auth login`, then run:

```sh
npm run release -- "Release notes"
```

The script runs unit tests and typechecking, builds the Apple Silicon ZIP and DMG using `npm run make`, tags the current commit as `v<package.json version>`, and pushes the tag to `origin`. It uploads both files through a draft GitHub release and then publishes it as the latest release. An existing draft can be retried; a public release is never overwritten. Bump the package version before creating another release. Without the notes argument, the script prompts in an interactive terminal. The DMG is created at `out/make/Y-Term-darwin-arm64-<version>.dmg`.

Local packaging is unsigned unless `APPLE_SIGN_IDENTITY` is provided. To also request notarization, provide `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` through your release environment. Do not commit credentials. Signing, notarization, Gatekeeper assessment of the downloaded artifact, and clean-machine validation are release requirements still pending. Intel builds are outside the current target.

Split panes, saved live processes, plugins, automatic updates, and dedicated SSH management are outside this first version. Use the installed `ssh` command inside a shell.

Third-party packages and their upstream notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
