import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveFileLink(value: unknown, cwd: string | undefined, home: string): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Invalid local file link.');
  }
  let path = value;
  if (/^file:/i.test(path)) {
    const url = new URL(path);
    if ((url.hostname && url.hostname !== 'localhost') || url.search) throw new Error('Only local file URLs can be opened.');
    url.pathname = url.pathname.replace(/:\d+(?::\d+)?$/, '');
    path = fileURLToPath(url);
  } else {
    if (/^[a-z][a-z\d+.-]*:/i.test(path)) {
      // A bare filename can also have a line/column suffix.
      if (!/^[^/:]+:\d+(?::\d+)?$/.test(path)) throw new Error('Only local file links can be opened.');
    }
    path = path.replace(/:\d+(?::\d+)?$/, '');
  }
  if (/[\x00-\x1f\x7f]/.test(path)) throw new Error('Invalid local file link.');
  if (path.startsWith('~/')) path = resolve(home, path.slice(2));
  if (!isAbsolute(path) && !cwd) throw new Error('Cannot determine this terminal session’s current directory.');
  return resolve(cwd ?? '/', path);
}

export async function openFileLink(value: unknown, cwd: string | undefined, home: string,
  open: (path: string) => Promise<string>): Promise<void> {
  const path = resolveFileLink(value, cwd, home);
  await stat(path);
  const error = await open(path);
  if (error) throw new Error(error);
}
