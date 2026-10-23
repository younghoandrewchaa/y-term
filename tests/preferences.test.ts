import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreferencesStore, validatePreferences, visibleBounds } from '../src/main/preferences.ts';

test('recovers from corrupt settings and persists only validated preferences', () => {
  const directory = mkdtempSync(join(tmpdir(), 'y-term-settings-'));
  try {
    writeFileSync(join(directory, 'preferences.json'), '{broken');
    const store = new PreferencesStore(directory);
    assert.equal(store.get().fontSize, 14);
    store.save({ ...store.get(), fontSize: 18, theme: 'light' });
    assert.equal(new PreferencesStore(directory).get().fontSize, 18);
    assert.equal(JSON.parse(readFileSync(join(directory, 'preferences.json'), 'utf8')).theme, 'light');
    assert.throws(() => store.save({ ...store.get(), fontSize: -1 }), /font/i);
    assert.equal(store.get().fontSize, 18);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('rejects malformed, excessive, and relative-path settings', () => {
  for (const value of [null, [], { fontSize: 1000 }, { scrollback: Infinity }, { shell: 'zsh' }, { cwd: 'relative' }, { theme: 'unknown' }, { fontFamily: '\u0000' }]) {
    assert.throws(() => validatePreferences(value));
  }
});

test('moves windows from a disconnected display onto an available display', () => {
  assert.deepEqual(visibleBounds({ x: 3000, y: 0, width: 1000, height: 700 }, [
    { x: 0, y: 0, width: 1440, height: 900 },
  ]), { x: 220, y: 100, width: 1000, height: 700 });
  assert.deepEqual(visibleBounds({ x: -100, y: -50, width: 4000, height: 3000 }, [
    { x: 0, y: 0, width: 1440, height: 900 },
  ]), { x: 0, y: 0, width: 1440, height: 900 });
});
