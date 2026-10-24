# Terminal visual redesign

Use `/Users/youngho/Downloads/y-term.html/Blocks.dc.html` as the visual reference. The user selected a visual redesign first, retaining continuous terminal interaction.

## Approach

Adapt the reference's 232px session sidebar, 48px header, dark surfaces, fine borders, rounded controls, and blue accent to the existing Electron renderer. Keep xterm as the terminal surface. A palette-only refresh would miss the reference's layout; command cards and a separate composer would change shell interaction and are deferred by the user's scope choice.

## Constraints and decisions

- Preserve shell input, paste, file drops, search, settings, tab lifecycle, native traffic lights, and existing menu shortcuts.
- Use existing local system fonts and inline SVG icons; add no dependencies or external requests.
- Keep the light theme, styled with the same layout and contrast hierarchy.
- Show the active shell title and its configured starting directory in the header; do not imply that the configured path tracks `cd`.
- Keep closing sessions accessible by mouse and keyboard. Use vertical tab navigation and scroll the session list independently.
- Adapt the sidebar at small window sizes and include a useful empty state after the last shell closes.
- Do not add fake command history, exit statuses, command shortcuts, or command cards.

## Validation

Run unit tests, typecheck, build, and real Electron smoke checks. Inspect screenshots at default and minimum window sizes and in both themes, including long titles, many sessions, settings, search, and the empty state.
