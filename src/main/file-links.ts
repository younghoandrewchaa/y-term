import { stat } from 'node:fs/promises';
import { isAbsolute, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A line, line:column or line-range suffix such as `:12`, `:12:4` or `:12-40`. */
const LINE_REFERENCE = /:\d+(?:[:-]\d+)?$/;

export function resolveFileLink(value: unknown, cwd: string | undefined, home: string): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Invalid local file link.');
  }
  let path = value;
  if (/^file:/i.test(path)) {
    const url = new URL(path);
    if ((url.hostname && url.hostname !== 'localhost') || url.search) throw new Error('Only local file URLs can be opened.');
    url.pathname = url.pathname.replace(LINE_REFERENCE, '');
    path = fileURLToPath(url);
  } else {
    if (/^[a-z][a-z\d+.-]*:/i.test(path)) {
      // A bare filename can also have a line/column suffix.
      if (!/^[^/:]+:\d+(?:[:-]\d+)?$/.test(path)) throw new Error('Only local file links can be opened.');
    }
    path = path.replace(LINE_REFERENCE, '');
  }
  if (/[\x00-\x1f\x7f]/.test(path)) throw new Error('Invalid local file link.');
  if (path.startsWith('~/')) path = resolve(home, path.slice(2));
  if (!isAbsolute(path) && !cwd) throw new Error('Cannot determine this terminal session’s current directory.');
  return resolve(cwd ?? '/', path);
}

/** The cwd-relative path a link names, if it is a plain relative path that could be searched for. */
function relativeLink(value: string): string | undefined {
  if (/^(?:file:|~\/)/i.test(value)) return undefined;
  const path = normalize(value.replace(LINE_REFERENCE, ''));
  if (isAbsolute(path) || path === '.' || path === '..' || path.startsWith('../')) return undefined;
  return path;
}

export async function openFileLink(value: unknown, cwd: string | undefined, home: string,
  open: (path: string) => Promise<string>, diff?: (path: string) => Promise<boolean>,
  locate?: (path: string) => Promise<string | undefined>): Promise<void> {
  let path = resolveFileLink(value, cwd, home);
  try { await stat(path); } catch (error) {
    // Agents often print paths relative to the module they discuss rather than the shell's directory.
    const relative = (error as NodeJS.ErrnoException).code === 'ENOENT' && locate ? relativeLink(value as string) : undefined;
    const found = relative && await locate!(relative);
    if (!found) throw error;
    path = found;
    await stat(path);
  }
  // A line reference points at a location to read, not at changes to review.
  if (diff && !LINE_REFERENCE.test(value as string) && await diff(path)) return;
  const error = await open(path);
  if (error) throw new Error(error);
}
