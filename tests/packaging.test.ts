import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

test('the packager ZIP extractor completes large file streams on the build Node version', () => {
  const root = mkdtempSync(join(tmpdir(), 'y-term-packaging-'));
  const require = createRequire(import.meta.url);
  const packagerRequire = createRequire(require.resolve('@electron/packager'));
  const extractor = packagerRequire.resolve('extract-zip');
  const content = randomBytes(256 * 1024);
  try {
    writeFileSync(join(root, 'payload'), content);
    const zip = spawnSync('zip', ['fixture.zip', 'payload'], { cwd: root, encoding: 'utf8' });
    assert.equal(zip.status, 0, zip.stderr);
    // Top-level await turns the dependency's silent unfinished promise into a failure.
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { createRequire } from 'node:module';
      const require = createRequire(import.meta.url);
      await require(${JSON.stringify(extractor)})(${JSON.stringify(join(root, 'fixture.zip'))},
        { dir: ${JSON.stringify(join(root, 'extracted'))} });
    `], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(join(root, 'extracted/payload')), content);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
