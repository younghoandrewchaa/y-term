# Tab Drag-and-Drop Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user drag a tab in the sidebar up or down to change its position.

**Architecture:** A pure `moveTab` helper in `src/shared/tab-order.ts` reorders the `tabs` array and is unit-tested. The renderer (`src/renderer/app.ts`) makes each `.tab` wrapper an HTML5 drag source and drop target, shows an accent line where the tab will land, then calls `moveTab`, moves the DOM node, renumbers the ⌘1–⌘9 badges and publishes the layout (so an update restart reopens tabs in the new order). A Playwright smoke check drags a tab for real.

**Tech Stack:** TypeScript, Electron 42, HTML5 Drag and Drop, `node:test`, Playwright 1.64.

**Spec:** The user's request: "When there are multiple tabs on the side bar, I'd like to move the tab up or down by drag and drop." No separate spec document.

## Global Constraints

- Drag data uses only the custom type `application/x-y-term-tab`. It must never carry `Files` or `text/plain`, so the file-drop handlers (`src/renderer/file-drop.ts`, `app.ts:14-21`) and xterm's textarea ignore a tab drag.
- Moving a tab does not change which tab is selected.
- A moved tab forgets its opener (as Chrome does), so ⌘T from its old opener no longer tries to group next to it.
- After a move: `renumberTabs()` and `publishLayout()` run, same as after open/close.
- Site (`CLAUDE.md`): update the "Tabs that follow you" card in `site/index.html`; set `.win-version` to `0.1.16`; render light and dark.

## Review Focus

1. **Dropping a tab on itself or on the gap next to itself** — nothing changes, no layout publish needed. Pinned by the `moveTab` no-op test (Task 1).
2. **Dragging a tab over the terminal and releasing** — nothing is pasted into the shell and the order is unchanged. Pinned by the smoke step in Task 2.
3. **Dragging a Finder file over the sidebar** — no drop line appears and the tab order is untouched (the handler checks the custom type). Pinned by the type check in Task 2's `dragover` and the smoke step.
4. **Moving the selected tab** — it stays selected and the ⌘ digit badges follow the new order. Pinned by the smoke assertions in Task 2.
5. **Pressing Escape mid-drag / dragging out of the window** — the drop line is cleared (`dragend` always clears it). Pinned by the smoke check that no `[data-drop]` remains after the drag.

---

### Task 1: `moveTab` helper

**Files:**
- Modify: `src/shared/tab-order.ts`
- Test: `tests/tab-order.test.ts`

**Interfaces:**
- Produces: `moveTab<T extends { opener?: T }>(items: T[], from: number, to: number): boolean` — `to` is an insertion slot in the array *before* removal (0…`items.length`), which is what the drop line shows ("before tab i" = slot i, "after tab i" = slot i+1). Moves the item, clears its `opener`, returns `true`; returns `false` and changes nothing when the slot is `from` or `from + 1`, or either index is out of range.

- [ ] **Step 1: Write the failing tests** in `tests/tab-order.test.ts` (reuse the existing `node`/`ids` helpers):

```ts
test('dragging a tab down lands it in the slot the drop line showed', () => {
  const items = ['a', 'b', 'c', 'd'].map(id => node(id));
  assert.equal(moveTab(items, 0, 3), true);          // drop line between c and d
  assert.deepEqual(ids(items), ['b', 'c', 'a', 'd']);
});

test('dragging a tab up lands it in the slot the drop line showed', () => {
  const items = ['a', 'b', 'c', 'd'].map(id => node(id));
  assert.equal(moveTab(items, 3, 1), true);          // drop line between a and b
  assert.deepEqual(ids(items), ['a', 'd', 'b', 'c']);
  assert.equal(moveTab(items, 0, 4), true);          // after the last tab
  assert.deepEqual(ids(items), ['d', 'b', 'c', 'a']);
});

test('dropping a tab beside itself changes nothing', () => {
  const a = node('a'); const b = node('b', a); const items = [a, b, node('c')];
  assert.equal(moveTab(items, 1, 1), false);
  assert.equal(moveTab(items, 1, 2), false);
  assert.equal(moveTab(items, 5, 0), false);
  assert.equal(moveTab(items, 0, 9), false);
  assert.deepEqual(ids(items), ['a', 'b', 'c']);
  assert.equal(b.opener, a, 'a no-op keeps the opener');
});

test('a moved tab forgets its opener so new tabs no longer group with it', () => {
  const a = node('a'); const b = node('b', a); const items = [a, b, node('x')];
  moveTab(items, 1, 3);
  assert.equal(b.opener, undefined);
  insertAfterOpener(items, node('n', a), a, openerOf);
  assert.deepEqual(ids(items), ['a', 'n', 'x', 'b']);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `moveTab` is not exported.

- [ ] **Step 3: Implement `moveTab`** in `src/shared/tab-order.ts` with a one-line doc comment. Remove at `from`, insert at `to > from ? to - 1 : to`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test && npm run typecheck`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/tab-order.ts tests/tab-order.test.ts
git commit -m "Add moveTab helper for reordering sidebar tabs"
```

---

### Task 2: Drag tabs in the sidebar

**Files:**
- Modify: `src/renderer/app.ts` (in `newTab`, near lines 215-264; import at line 11)
- Modify: `src/renderer/styles.css` (after the `.tab` rules, lines 62-87)
- Create: `scripts/tab-drag-smoke.ts`
- Modify: `scripts/smoke.ts` (import beside line 12, call after `verifyTabShortcuts` at line 132)

**Interfaces:**
- Consumes: `moveTab(items, from, to)` from Task 1.
- Produces: `.tab` wrappers carry `draggable="true"`; while dragging, the dragged wrapper has `data-dragging` and the hovered one has `data-drop="before" | "after"`. `export async function verifyTabDrag(application: ElectronApplication, page: Page): Promise<void>`.

- [ ] **Step 1: Write the failing smoke check** `scripts/tab-drag-smoke.ts`, following `scripts/tab-shortcut-smoke.ts` (open tabs with the New tab button until there are 3, close the ones it opened at the end). It must:
  - Record `ids` (order of `[role=tab]` ids) and the selected id.
  - `await page.locator('.tab').nth(0).dragTo(page.locator('.tab').nth(2), { targetPosition: { x: 40, y: 44 } })` (lower half of a 52px tab → "after").
  - Assert order is `[ids[1], ids[2], ids[0]]`, the selected id is unchanged, and `.tab-number` text (read as in the shortcut smoke while holding ⌘, or straight from `textContent`) is `['1','2','3']` in the new order.
  - Drag the last tab onto the upper half of the first (`y: 8`) and assert it is now first.
  - Drag a tab onto `[role=tabpanel]:not([hidden]) .xterm-screen` and assert the order is unchanged and the terminal buffer (`page.locator('[role=tabpanel]:not([hidden]) .xterm-rows').textContent()`) gained no `application/x-y-term-tab` or tab id text.
  - Assert `await page.locator('[data-drop], [data-dragging]').count() === 0` after each drag.
  - Send `select-tab-1` (as the shortcut smoke does) and assert it selects the tab that is now first.

  Wire it into `scripts/smoke.ts` right after `verifyTabShortcuts`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL at the first order assertion (tabs are not draggable yet).

- [ ] **Step 3: Implement dragging in `newTab`** (`src/renderer/app.ts`), on the `wrapper`:
  - `wrapper.draggable = true`.
  - `dragstart`: `event.dataTransfer.setData('application/x-y-term-tab', button.id)`, `effectAllowed = 'move'`, set `wrapper.dataset.dragging`; keep the dragged `Tab` in a module-level `let dragged: Tab | undefined`.
  - `dragover`: return unless `dragged` is set and `event.dataTransfer.types` includes `application/x-y-term-tab`; `preventDefault()`, `dropEffect = 'move'`; set `data-drop` to `before` if `event.clientY` is above the wrapper's vertical midpoint, else `after`; clear `data-drop` on every other tab.
  - `dragleave`: clear this wrapper's `data-drop` when `event.relatedTarget` is outside it.
  - `drop`: `preventDefault()`; `to = tabs.indexOf(tab) + (after ? 1 : 0)`; if `moveTab(tabs, tabs.indexOf(dragged), to)`, reinsert `dragged.wrapper` with `tablist.insertBefore(dragged.wrapper, tabs[newIndex + 1]?.wrapper ?? null)`, then `renumberTabs()` and `publishLayout()`.
  - `dragend`: clear `dragged`, `data-dragging` and every `data-drop` (covers Escape and dropping outside).
  - Close button and agent status are untouched; `button.onclick` still selects.

- [ ] **Step 4: Add styles** to `src/renderer/styles.css`:
  - `.tab[data-dragging] { opacity: .5; }`
  - `.tab[data-drop]::before` — absolute, `left: 6px; right: 6px; height: 2px; border-radius: 1px; background: var(--accent); pointer-events: none;` with `top: -3px` for `before` and `bottom: -3px` for `after` (half of the 4px `#tabs` gap, so the line sits between tabs).

- [ ] **Step 5: Run checks**

Run: `npm test && npm run typecheck && npm run test:e2e`
Expected: all PASS, including the new drag smoke.

- [ ] **Step 6: Try it by hand** with `npm start`: open 3 tabs, drag one up and one down, check the accent line sits between tabs in light and dark, Escape cancels, and a Finder file dragged over the sidebar shows no line.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/app.ts src/renderer/styles.css scripts/tab-drag-smoke.ts scripts/smoke.ts
git commit -m "Reorder sidebar tabs by drag and drop"
```

---

### Task 3: Website

**Files:**
- Modify: `site/index.html:66` (the "Tabs that follow you" card) and `site/index.html:41` (`.win-version`)

- [ ] **Step 1: Update the card copy** to add: "Drag a tab up or down to put your sessions in the order you want." Keep the rest of the paragraph. No shortcut row is added (drag has no shortcut). The mock stays as is apart from the version: a static screenshot can't show a drag.

- [ ] **Step 2: Set `.win-version`** to `Y-Term 0.1.16` (matches `package.json`).

- [ ] **Step 3: Render both themes and look at them**

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --window-size=1200,1500 --screenshot=/private/tmp/site.png "file://$PWD/site/index.html"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --force-dark-mode --blink-settings=preferredColorScheme=0 \
  --window-size=1200,1500 --screenshot=/private/tmp/site-dark.png "file://$PWD/site/index.html"
```

Expected: the card reads correctly and the mock shows 0.1.16 in both images.

- [ ] **Step 4: Commit**

```bash
git add site/index.html
git commit -m "Describe dragging tabs on the website"
```

---

## Out of scope

- A keyboard way to move tabs (e.g. ⌥⌘↑/↓). Easy to add later on top of `moveTab` if you want it.
- Dragging a tab out to a new window.
