export interface TabSortKey { directory: string; agent: boolean }

/** Sidebar order: directory name, then tabs with a running agent first. */
export function compareTabs(a: TabSortKey, b: TabSortKey): number {
  return a.directory.localeCompare(b.directory, undefined, { sensitivity: 'base', numeric: true })
    || Number(b.agent) - Number(a.agent);
}
