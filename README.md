# Y-Term

A macOS terminal built with Electron, xterm.js, and local pseudoterminals. The initial distribution target is Apple Silicon.

Project website: <https://younghoandrewchaa.github.io/y-term/> (source in `site/`, deployed to GitHub Pages by `.github/workflows/pages.yml` on pushes to `main`).

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

Sessions appear in the left sidebar, with Settings at the bottom. The header shows the active shell title and its configured starting directory. Use Up/Down or Home/End while a session button has focus to switch sessions.

The bottom of the sidebar shows the installed app version. Signed Apple Silicon releases check GitHub for a newer stable release on startup and when a new tab opens, at most once every five minutes. If one is available, click **Update**, then confirm **Update and Restart**. The app downloads the signed update, installs it, and restarts automatically. All terminal sessions and running commands end on restart; save your work before confirming. Failed checks and downloads offer a retry. Development builds and automated tests do not check or install updates.

Drag the sidebar’s right edge to resize it; the app remembers your width across restarts. Double-click the edge to reset it. You can also focus the divider with Tab and use Left/Right to resize, or Home/End for the minimum/maximum width.

New tabs inherit the active shell’s current working directory. The configured starting directory is used for the first tab, or if the active shell’s directory is unavailable.

Click **Changes** in the session header, or press **⇧⌘G**, to review the active shell’s Git repository. Select a changed file to see old and new code side by side. **Unstaged** compares the index with the working tree and includes untracked files; **Staged** compares HEAD with the index. A partially staged file appears in both views. This panel is read-only; use the terminal for staging, discarding, and committing.

Changes refresh while the panel is visible and the window has focus, two seconds after each read completes. Use Refresh for an immediate check. The panel follows tab and directory changes. Wide windows keep the terminal beside the panel; Expand uses the workspace for review. Smaller windows open the review across the workspace, with horizontal scrolling when needed. Escape inside the panel closes it and returns focus to the live terminal.

The panel requires system Git. It displays diff hunks with three context lines, without syntax highlighting. Binary files, merge conflicts, submodules, and unsupported encodings show summaries. Reads stop after five seconds, status output is limited to 4 MiB, selected-file content/patches to 2 MiB, and rendering to 10,000 rows. Untracked symbolic-link targets are not read.

- ⌘T creates a tab; ⌘W closes the current tab and immediately terminates its shell and child programs. Control-Tab or ⇧⌘] switches to the next tab; Control-Shift-Tab or ⇧⌘[ switches to the previous tab.
- ⌘C and ⌘V copy and paste using the macOS Edit menu. Control-C remains the shell interrupt key. Multiline paste asks for confirmation.
- Shift+Enter inserts a newline in terminal agents that support modified Enter (CSI u). Enter submits as usual.
- Drag files or folders from Finder into a terminal to insert their quoted absolute paths. Multiple items become separate arguments followed by a space; press Enter yourself to run the command. Paths containing control characters (including tabs and newlines) are rejected.
- ⌘B shows or hides the sessions sidebar.
- ⌘F searches the active terminal; Enter and Shift-Enter move between matches; Escape closes search.
- ⌘+ / ⌘− change font size, ⌘0 resets it, and ⌘K clears the display.
- ⌘-click or Control-click opens HTTP/HTTPS links in your browser and local file paths in their default macOS app. Relative paths use the terminal session's current directory; quoted paths with spaces and local `file:` hyperlinks are supported.
- ⌘, opens settings. Font, theme, and scrollback apply immediately. Shell and initial directory changes apply to new tabs.

Settings and window placement are stored in `preferences.json` inside Electron's macOS user-data directory (`~/Library/Application Support/Y-Term`). Invalid or corrupt files recover with defaults. Terminal output and credentials are not saved. Quitting ends shells; reopening creates fresh ones.

Known shells start interactively as login shells. Finder launch therefore uses the shell's login configuration for PATH, including macOS `/etc/zprofile`. Custom shell startup files can still replace PATH or fail; verify installed tools from a Finder launch.

## Validate and package

```sh
npm test
npm run typecheck
npm run test:pty
npm run test:e2e
npm run test:updates
npm run test:git
npm run package
npm run test:packaged
npm run make
```

The smoke test launches real Electron and real PTYs using a temporary settings directory. It executes shell commands, resizes the window, switches and closes independent tabs, and checks URL restrictions. `test:packaged` runs the same checks against `out/Y-Term-darwin-arm64/Y-Term.app/Contents/MacOS/Y-Term`. Packaging unpacks node-pty so its native binding and spawn helper remain accessible. `npm run make` creates a ZIP and a DMG in `out/make`.

The smoke suite also checks sidebar scrolling, both themes, search, long titles, minimum window size, and the empty state. Set `Y_TERM_SCREENSHOTS=/private/tmp/y-term-screenshots` when running `npm run test:e2e` to capture the visual checks.

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

The script runs unit tests and typechecking, builds the Apple Silicon ZIP and DMG with signing and notarization enabled, tags the current commit as `v<package.json version>`, and pushes the tag to `origin`. The app is notarized and stapled before packaging. The DMG is then signed, submitted to Apple, and stapled; notarization and Gatekeeper checks must pass before either file is uploaded. It uploads both files through a draft GitHub release and then publishes it as the latest release. An existing draft can be retried; a public release is never overwritten. Bump the package version before creating another release. Without the notes argument, the script prompts in an interactive terminal. The DMG is created at `out/make/Y-Term-darwin-arm64-<version>.dmg`.

Releases require an installed Developer ID Application certificate; `APPLE_SIGN_IDENTITY` can select a specific identity. Notarization defaults to the saved `m-note` Keychain profile used by the reference project. Set `APPLE_KEYCHAIN_PROFILE` to use another profile, or provide `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` (also accepts `APPLE_ID_PASSWORD`), and `APPLE_TEAM_ID`. Do not commit credentials.

Run `npm run make:release` to build and notarize both artifacts without publishing to GitHub. Plain `npm run make` remains available for local packaging and is unsigned unless `APPLE_SIGN_IDENTITY` is provided. Gatekeeper assessment of the downloaded release and clean-machine validation remain manual checks. Intel builds are outside the current target.

The release script also generates and uploads `update-darwin-arm64.json`, a static Squirrel.Mac manifest pointing to that release's signed ZIP. Releases without this manifest are skipped by the update checker. Install the first release containing the updater manually; subsequent releases made with `npm run release` support in-app updates. Before shipping, validate a real update between two signed releases installed in a writable Applications folder, including signature rejection, offline retry, terminal cleanup and relaunch. Unit and GUI tests simulate the native updater and do not replace this signed-app check.

Split panes, saved live processes, plugins, and dedicated SSH management are outside this first version. Use the installed `ssh` command inside a shell.

Third-party packages and their upstream notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
