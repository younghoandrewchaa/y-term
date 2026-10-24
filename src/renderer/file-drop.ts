/** Quote native macOS paths as literal Unix shell arguments. */
export function formatDroppedPaths(paths: readonly string[]): string {
  for (const path of paths) {
    if (!path.startsWith('/') || /[\x00-\x1f\x7f]/.test(path)) {
      throw new Error('Cannot insert this selection: paths must be absolute and contain no control characters.');
    }
  }
  return paths.length ? paths.map(path => `'${path.replaceAll("'", "'\\''")}'`).join(' ') + ' ' : '';
}
