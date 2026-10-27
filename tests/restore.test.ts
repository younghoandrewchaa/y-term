import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { takeSnapshot, validateSnapshot, writeSnapshot } from '../src/main/restore.ts';
import type { RestoreSnapshot } from '../src/main/restore.ts';

const id = '0b6c2f0e-3d4a-4c1b-9e8f-1a2b3c4d5e6f';
const snapshot: RestoreSnapshot = { version: '0.2.0', windows: [{
  bounds: { x: 10, y: 20, width: 1100, height: 750 }, active: 1,
  tabs: [{ cwd: '/tmp/a' }, { cwd: '/tmp/b', resume: { agent: 'claude', id } }, {}],
}] };

test('writes a private snapshot and reads it back exactly once for the installed version', () => {
  const directory = mkdtempSync(join(tmpdir(), 'y-term-restore-'));
  writeSnapshot(directory, snapshot);
  const file = join(directory, 'restore-after-update.json');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(takeSnapshot(directory, '0.2.0'), snapshot);
  assert.equal(existsSync(file), false);
  assert.equal(takeSnapshot(directory, '0.2.0'), undefined);
});

test('a failed update relaunching the old version discards the snapshot', () => {
  const directory = mkdtempSync(join(tmpdir(), 'y-term-restore-'));
  writeSnapshot(directory, snapshot);
  assert.equal(takeSnapshot(directory, '0.1.9'), undefined);
  assert.equal(existsSync(join(directory, 'restore-after-update.json')), false);
});

test('malformed snapshots are discarded instead of restored', () => {
  const directory = mkdtempSync(join(tmpdir(), 'y-term-restore-'));
  writeFileSync(join(directory, 'restore-after-update.json'), '{not json');
  assert.equal(takeSnapshot(directory, '0.2.0'), undefined);
  assert.equal(existsSync(join(directory, 'restore-after-update.json')), false);
});

test('rejects unsafe directories, commands and out-of-range tabs', () => {
  const window = snapshot.windows[0];
  const invalid = [
    { ...snapshot, version: '0.2.0; rm -rf' },
    { ...snapshot, windows: [{ ...window, tabs: [{ cwd: 'relative' }], active: 0 }] },
    { ...snapshot, windows: [{ ...window, tabs: [{ cwd: '/tmp/\nx' }], active: 0 }] },
    { ...snapshot, windows: [{ ...window, tabs: [{ resume: { agent: 'claude', id: `${id}; curl x` } }], active: 0 }] },
    { ...snapshot, windows: [{ ...window, tabs: [{ resume: { agent: 'bash', id } }], active: 0 }] },
    { ...snapshot, windows: [{ ...window, active: 3 }] },
    { ...snapshot, windows: [{ ...window, tabs: [], active: 0 }] },
    { ...snapshot, windows: [{ ...window, tabs: Array(33).fill({}), active: 0 }] },
    { ...snapshot, windows: [{ ...window, bounds: { x: 0, y: 0, width: 1, height: 1 } }] },
  ];
  for (const value of invalid) assert.throws(() => validateSnapshot(value), JSON.stringify(value).slice(0, 120));
});

test('drops unknown fields so nothing else can ride along in the snapshot', () => {
  const extra = JSON.parse(JSON.stringify(snapshot));
  extra.windows[0].tabs[0].command = 'curl evil';
  extra.windows[0].extra = true;
  assert.deepEqual(validateSnapshot(extra), snapshot);
  const directory = mkdtempSync(join(tmpdir(), 'y-term-restore-'));
  writeSnapshot(directory, extra);
  assert.doesNotMatch(readFileSync(join(directory, 'restore-after-update.json'), 'utf8'), /curl/);
});
