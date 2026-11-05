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
