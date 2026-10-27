# Local file links

## Intent

Make file references in terminal output, including Codex messages, open with the file's default macOS app using Cmd+click (or Ctrl+click), matching existing web links.

## Behaviour

- Recognise plain relative paths such as `docs/superpowers/plans/2026-10-27-git-diff-panel.md`, absolute paths, home-relative paths, and explicit OSC 8 local `file:` links.
- Exclude surrounding Markdown and sentence punctuation from detected paths. Support paths that wrap across terminal rows and quoted paths containing spaces.
- Resolve relative paths against the clicked terminal session's current directory. Resolve `~/` against the user's home directory.
- Open existing files with the default macOS application. Report missing files and opening failures through the existing status display.
- Keep ordinary clicks available for terminal selection and preserve HTTP/HTTPS link behaviour.

## Approaches

The user chose the default macOS application over a specific editor. Use the existing xterm link activation flow with an additional local-path provider and a main-process file-opening handler. A separate preview panel or editor integration would add behaviour outside this request.

## Implementation boundaries

Use xterm's public link-provider and buffer APIs to detect and position plain path links. Pass the terminal session ID with file-opening requests so the main process can enforce session ownership and obtain the correct directory. Decode local file URLs separately from web URLs and open resolved filesystem paths through Electron's native path-opening API. Do not run shell commands assembled from link text or broaden the web URL policy to arbitrary protocols.

No editor preferences, file preview UI, or editor-specific line navigation are included. For references with line/column suffixes, open the underlying file.

## Validation

Add regression coverage for path parsing, punctuation, wrapping, Unicode positioning, file URL decoding, directory resolution, and session ownership. Extend the existing Electron link smoke test to verify that Cmd+click reaches the native file-opening API with the resolved path, ordinary clicks do nothing, and existing web links still work. Run the unit suite, typecheck, build, and applicable smoke checks.
