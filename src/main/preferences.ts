import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { Preferences, WindowBounds } from '../shared/terminal-protocol.ts';

export function defaultPreferences(): Preferences {
  return {
    fontFamily: 'Menlo, Monaco, monospace', fontSize: 14, theme: 'dark', scrollback: 10000,
    shell: process.env.SHELL && isAbsolute(process.env.SHELL) ? process.env.SHELL : '/bin/zsh', cwd: homedir(),
  };
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function validatePreferences(value: unknown): Preferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid preferences.');
  const p = { ...defaultPreferences(), ...value } as Preferences;
  if (!integer(p.fontSize, 9, 36)) throw new Error('Font size must be between 9 and 36.');
  if (typeof p.fontFamily !== 'string' || !p.fontFamily.trim() || p.fontFamily.length > 200 || /[\x00-\x1f]/.test(p.fontFamily)) throw new Error('Invalid font family.');
  if (p.theme !== 'dark' && p.theme !== 'light') throw new Error('Invalid theme.');
  if (!integer(p.scrollback, 100, 100000)) throw new Error('Scrollback must be between 100 and 100000.');
  if (p.sidebarWidth !== undefined && !integer(p.sidebarWidth, 180, 480)) throw new Error('Sidebar width must be between 180 and 480.');
  for (const key of ['shell', 'cwd'] as const) {
    if (typeof p[key] !== 'string' || !isAbsolute(p[key]) || p[key].length > 4096 || /[\x00-\x1f]/.test(p[key])) throw new Error(`${key} must be an absolute path.`);
  }
  const bounds = p.bounds === undefined ? undefined : validateBounds(p.bounds);
  return { fontFamily: p.fontFamily, fontSize: p.fontSize, theme: p.theme, scrollback: p.scrollback, shell: p.shell, cwd: p.cwd, ...(p.sidebarWidth !== undefined ? { sidebarWidth: p.sidebarWidth } : {}), ...(bounds ? { bounds } : {}) };
}

export function validateBounds(value: unknown): WindowBounds {
  const b = value as WindowBounds;
  if (!b || typeof b !== 'object' || !integer(b.x, -100000, 100000) || !integer(b.y, -100000, 100000) || !integer(b.width, 400, 10000) || !integer(b.height, 300, 10000)) throw new Error('Invalid window bounds.');
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

export class PreferencesStore {
  private directory: string;
  private value: Preferences;
  constructor(directory: string) {
    this.directory = directory;
    try { this.value = validatePreferences(JSON.parse(readFileSync(join(directory, 'preferences.json'), 'utf8'))); }
    catch { this.value = defaultPreferences(); }
  }
  get(): Preferences { return structuredClone(this.value); }
  save(value: unknown): Preferences {
    const valid = validatePreferences(value);
    mkdirSync(this.directory, { recursive: true });
    const path = join(this.directory, 'preferences.json');
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(valid, null, 2), { mode: 0o600 });
    renameSync(temporary, path);
    this.value = valid;
    return this.get();
  }
}

export function visibleBounds(saved: WindowBounds | undefined, displays: WindowBounds[]): WindowBounds {
  const primary = displays[0] ?? { x: 0, y: 0, width: 1440, height: 900 };
  const b = saved ?? { x: primary.x, y: primary.y, width: 1100, height: 750 };
  const display = displays.find(d => b.x >= d.x && b.y >= d.y && b.x + b.width <= d.x + d.width && b.y + b.height <= d.y + d.height) ?? primary;
  const width = Math.min(b.width, display.width);
  const height = Math.min(b.height, display.height);
  const contained = b.x >= display.x && b.y >= display.y && b.x + width <= display.x + display.width && b.y + height <= display.y + display.height;
  return {
    x: contained ? b.x : Math.round(display.x + (display.width - width) / 2),
    y: contained ? b.y : Math.round(display.y + (display.height - height) / 2), width, height,
  };
}
