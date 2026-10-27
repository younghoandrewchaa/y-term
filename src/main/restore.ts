import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { validateAgentResume } from '../shared/agent-resume.ts';
import type { RestoredTab, RestoredTabs, WindowBounds } from '../shared/terminal-protocol.ts';
import { validateBounds } from './preferences.ts';

export interface RestoreWindow extends RestoredTabs { bounds: WindowBounds }
/** Tabs to reopen after an update restart, valid only for the version being installed. */
export interface RestoreSnapshot { version: string; windows: RestoreWindow[] }

const FILE = 'restore-after-update.json';
const MAX_WINDOWS = 16;
const MAX_TABS = 32;

function validateTab(value: unknown): RestoredTab {
  if (!value || typeof value !== 'object') throw new Error('Invalid restored tab.');
  const { cwd, resume } = value as Record<string, unknown>;
  if (cwd !== undefined && (typeof cwd !== 'string' || !isAbsolute(cwd) || cwd.length > 4096 || /[\x00-\x1f]/.test(cwd))) throw new Error('Invalid restored directory.');
  return { ...(cwd !== undefined ? { cwd } : {}), ...(resume !== undefined ? { resume: validateAgentResume(resume) } : {}) };
}

export function validateSnapshot(value: unknown): RestoreSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid restore snapshot.');
  const { version, windows } = value as Record<string, unknown>;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid restore version.');
  if (!Array.isArray(windows) || windows.length > MAX_WINDOWS) throw new Error('Invalid restored windows.');
  return { version, windows: windows.map(window => {
    if (!window || typeof window !== 'object') throw new Error('Invalid restored window.');
    const { bounds, tabs, active } = window as Record<string, unknown>;
    if (!Array.isArray(tabs) || !tabs.length || tabs.length > MAX_TABS) throw new Error('Invalid restored tabs.');
    if (typeof active !== 'number' || !Number.isInteger(active) || active < 0 || active >= tabs.length) throw new Error('Invalid active tab.');
    return { bounds: validateBounds(bounds), tabs: tabs.map(validateTab), active };
  }) };
}

export function writeSnapshot(directory: string, snapshot: RestoreSnapshot): void {
  const valid = validateSnapshot(snapshot);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, FILE);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(valid), { mode: 0o600 });
  renameSync(temporary, path);
}

export function discardSnapshot(directory: string): void {
  rmSync(join(directory, FILE), { force: true });
}

/** Reads the snapshot at most once; a failed update relaunches the old version, which ignores it. */
export function takeSnapshot(directory: string, currentVersion: string): RestoreSnapshot | undefined {
  let snapshot: RestoreSnapshot | undefined;
  try { snapshot = validateSnapshot(JSON.parse(readFileSync(join(directory, FILE), 'utf8'))); }
  catch { /* Missing or unreadable snapshots start a normal session. */ }
  try { discardSnapshot(directory); }
  catch (error) { console.error('Could not remove restore snapshot:', error); }
  return snapshot?.version === currentVersion ? snapshot : undefined;
}
