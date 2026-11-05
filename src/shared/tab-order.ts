/** Sidebar order, as in Chrome: a new tab goes after the tab it was opened from and that tab's earlier descendants. */
export function insertAfterOpener<T>(items: T[], item: T, source: T | undefined, openerOf: (item: T) => T | undefined): number {
  const start = source === undefined ? -1 : items.indexOf(source);
  let index = start === -1 ? items.length : start + 1;
  const descends = (candidate: T) => {
    for (let opener = openerOf(candidate); opener !== undefined; opener = openerOf(opener)) if (opener === source) return true;
    return false;
  };
  if (start !== -1) while (index < items.length && descends(items[index])) index++;
  items.splice(index, 0, item);
  return index;
}

/** ⌘1–⌘8 pick a tab by position and ⌘9 picks the last one, as in Chrome and Safari. */
export function shortcutTabIndex(digit: number, count: number): number | undefined {
  const index = digit === 9 ? count - 1 : digit - 1;
  return index >= 0 && index < count ? index : undefined;
}

/** The digit shown on a tab while ⌘ is held: the inverse of `shortcutTabIndex`. */
export function tabShortcutDigit(index: number, count: number): number | undefined {
  if (index < 8) return index + 1;
  return index === count - 1 ? 9 : undefined;
}

/** When a tab closes, its children take over its opener, as in Chrome, so the closed tab can be freed. */
export function detachOpener<T extends { opener?: T }>(items: T[], closed: T): void {
  for (const item of items) if (item.opener === closed) item.opener = closed.opener;
  closed.opener = undefined;
}
