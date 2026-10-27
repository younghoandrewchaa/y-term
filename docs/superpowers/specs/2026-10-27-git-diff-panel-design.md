# Git diff panel design

Status: proposed design accompanying the requested implementation plan. The defaults below are recommendations, not previously approved requirements.

## Intent and scope

Review local changes without leaving Y-Term. A Changes button in the active session header opens a file list and a side-by-side diff. The active shell's working directory determines the repository, including when it is inside a subdirectory or linked worktree.

The first version is read-only. Include unstaged tracked changes, staged changes, and untracked text files. Exclude staging, discarding, editing, committing, branch comparisons, history, full-file expansion, syntax highlighting, and merge resolution. The existing terminal remains usable and its process keeps running while reviewing changes.

## Approaches

1. **Recommended: native HTML/CSS diff hunks.** Use Git's patch output, align removed and added lines, and render safe text in a small TypeScript component. Fits the current framework-free renderer and adds no runtime dependency. Requires focused parsing and alignment tests; does not provide editor features.
2. **Embedded editor diff component.** Provides richer navigation and full-file comparison but adds a substantial dependency, build integration, and editor lifecycle. Reconsider if editing or full-file browsing becomes a requirement.
3. **Terminal viewer integration.** Launching delta is useful independently, but introduces an external installation and does not produce the requested clickable application panel.

This draft proceeds with approach 1 for review. Implementation starts after the proposed scope and design are accepted.

## Interaction and layout

- Add a Changes button and View > Toggle Changes with `CmdOrCtrl+Shift+G`.
- Show repository name, Refresh, Expand/Restore, Close, and Unstaged/Staged selectors. Untracked files appear under Unstaged with a distinct badge. A partially staged file appears in both views with different comparisons.
- In a workspace at least 1100 CSS pixels wide, open a right-hand panel initially occupying 65% of workspace width, constrained to leave a 320-pixel terminal and at least a 720-pixel review panel. Provide a draggable and keyboard-operable divider. Width is session-only in v1.
- Below that width, or when expanded, the review panel occupies the workspace content area and temporarily hides the terminal visually. Keep the session sidebar. Restore reveals and refits the live terminal.
- The review panel contains a 180-pixel file list and two equal diff columns. At narrow widths allow horizontal overflow of a minimum 640-pixel review surface rather than crushing code columns.
- Label columns according to comparison: Index / Working tree for unstaged, HEAD / Index for staged, Empty / Working tree for untracked. Render line numbers, context lines, additions/deletions, blank alignment cells, hunk separators, and missing-final-newline markers.
- Render three lines of context; do not wrap code. Use one shared vertical scroll region for aligned rows and a shared horizontal scrolling surface. Use theme variables and explicit +/− markers as well as background colors.
- Clicking a file selects it. Up/Down in the file list moves selection. Escape while focus is within the panel closes it and returns focus to the terminal. Modal dialogs retain existing precedence. Preserve native code selection and copy.
- Provide explicit loading, clean repository, no active session, outside repository, Git unavailable, shell exited, file changed during loading, and command failure states. Binary, conflicted, submodule, unsupported encoding, and oversized files show an explanatory summary.

## Data and refresh

Keep the renderer sandbox and CSP. Add two typed preload methods for status and selected-file diff. Requests identify an owned terminal session; main resolves its live directory. Never accept a renderer-supplied repository root or arbitrary executable.

Use argument-array Git subprocesses without a shell. Discover the root with `rev-parse --show-toplevel`; enumerate with `status --porcelain=v1 -z --untracked-files=all`. Use both status columns so staged and unstaged entries stay distinct. Parse NUL-delimited paths and rename source records. All file arguments use literal pathspecs and `--`.

Tracked unstaged diffs compare the index to the working tree; staged diffs use `--cached` and work before the first commit. Disable external diff and text conversion, force uncolored standard unified output, and do not read or render repository files as HTML. Restrict each diff request to a current status entry in its requested section. Renames retain both paths and display metadata even when no text changed.

For untracked regular UTF-8 text, read a bounded file and model every line as an addition. Do not follow symlinks; tracked symlink changes use Git's patch representation. Non-UTF-8 filenames receive an unsupported-path summary rather than lossy round-tripping. Binary and invalid UTF-8 content are not coerced into text.

Refresh on open, explicit Refresh, active-tab/directory change, window focus, and every two seconds after the previous refresh completes while the panel is visible and the window is focused. Refresh the selected diff even when status codes are unchanged. Stop polling when hidden, unfocused, or disposed. No filesystem watcher in v1.

Use generation counters to discard responses after selection, section, session, directory, or visibility changes. Each refresh resolves the session directory again. If it differs from the displayed repository, discard the old selection and reload status. A removed/cleaned file clears its old diff. Preserve selection and scroll for unchanged content. Do not promise an atomic snapshot while another process edits or stages files; show a retry state when results no longer match.

## Resource and trust constraints

Proposed limits: five-second subprocess timeout; 4 MiB status output; 2 MiB selected-file patch or untracked content; 10,000 rendered diff rows. Exceeding a limit returns an explicit state and terminates the bounded operation, never a silently truncated diff. Allow only one refresh cycle per window, coalesce repeated refresh triggers, and release resources when its owner closes.

Validate the trusted main frame and session ownership using existing patterns. Reject absolute paths, traversal, unknown entries, invalid sections, and symlink escapes for direct reads. Validate inputs at runtime in main. Disable optional Git index writes, prompts, fsmonitor helpers, external diffs, and textconv for these reads; do not bypass Git's repository ownership checks. Recheck ownership and directory before returning results.

## Acceptance criteria

The two files from the motivating example can be selected and reviewed as aligned old/new hunks. Opening, resizing, expanding, refreshing, and closing the panel preserves the live shell. Staged and unstaged comparisons remain correct for the same file. Switching tabs cannot flash content from the previous repository. Both themes and the 640-pixel minimum window work. Git failures and unsupported files leave the terminal usable.

## Documentation references

- [Git status porcelain format](https://git-scm.com/docs/git-status)
- [Git diff comparisons and output options](https://git-scm.com/docs/git-diff)
- [Git literal pathspec option](https://git-scm.com/docs/git)

Git documentation was consulted through Context7 while preparing the plan. Verify exact command combinations against repository fixtures during implementation.
