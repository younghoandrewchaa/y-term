import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function release(mode = '') {
  const root = mkdtempSync(join(tmpdir(), 'y-term-release-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.1.0', productName: 'Y-Term' }));
  const log = join(root, 'commands');
  const mocks: Record<string, string> = {
    uname: 'echo Darwin',
    git: `
      case "$*" in
        'status --porcelain') [ "$MODE" != dirty ] || echo ' M src/main/index.ts' ;;
        'rev-parse HEAD') echo current ;;
        'rev-parse -q --verify refs/tags/v0.1.0^{commit}') exit 1 ;;
      esac`,
    gh: `
      if [ "$1 $2" = 'release view' ]; then
        if [ "$MODE" = public ]; then echo false; else exit 1; fi
      fi`,
    npm: `
      if [ "$*" = 'run make' ]; then
        [ "$Y_TERM_RELEASE" = 1 ] || exit 1
        [ "$MODE" != failed-build ] || exit 1
        mkdir -p out/make/zip/darwin/arm64
        echo fresh > out/make/zip/darwin/arm64/Y-Term-darwin-arm64-0.1.0.zip
        if [ "$MODE" != missing-dmg ]; then
          echo fresh > out/make/Y-Term-darwin-arm64-0.1.0.dmg
        fi
      fi`,
    security: 'echo \'1) ABCDEF "Developer ID Application: Test"\'',
    codesign: 'exit 0',
    spctl: 'exit 0',
    xcrun: `
      if [ "$1 $2" = 'notarytool submit' ]; then
        if [ "$MODE" = rejected ]; then echo '{"status":"Invalid"}'; else echo '{"status":"Accepted"}'; fi
      elif [ "$1 $2" = 'stapler validate' ] && [ "$MODE" = unstapled ]; then
        exit 1
      fi`,
  };
  for (const [name, body] of Object.entries(mocks)) {
    writeFileSync(join(bin, name), `#!/bin/bash\necho "${name} $*" >> "$LOG"\n${body}\n`, { mode: 0o755 });
  }
  // Exercise the actual script without touching this checkout or GitHub.
  mkdirSync(join(root, 'scripts'));
  const source = resolve('scripts/release.sh');
  const script = join(root, 'scripts/release.sh');
  if (existsSync(source)) writeFileSync(script, readFileSync(source));
  const notarize = resolve('scripts/notarize-dmg.sh');
  if (existsSync(notarize)) writeFileSync(join(root, 'scripts/notarize-dmg.sh'), readFileSync(notarize));
  let result;
  try {
    result = spawnSync('bash', [script, 'Release notes'], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LOG: log, MODE: mode,
        APPLE_ID: '', APPLE_SIGN_IDENTITY: '', APPLE_KEYCHAIN_PROFILE: 'test-profile' },
      encoding: 'utf8',
    });
    return { status: result.status, output: result.stdout + result.stderr, commands: existsSync(log) ? readFileSync(log, 'utf8') : '' };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('release builds and uploads ZIP and DMG before publishing its draft', () => {
  const result = release();
  assert.equal(result.status, 0, result.output);
  assert.match(result.commands, /npm test/);
  assert.match(result.commands, /npm run typecheck/);
  assert.match(result.commands, /codesign --force --timestamp --sign Developer ID Application: Test .*\.dmg/);
  assert.match(result.commands, /xcrun notarytool submit .*\.dmg --keychain-profile test-profile --wait --output-format json/);
  assert.match(result.commands, /xcrun stapler staple .*\.dmg/);
  assert.match(result.commands, /xcrun stapler validate .*\.dmg/);
  assert.ok(result.commands.indexOf('xcrun stapler staple') < result.commands.indexOf('gh release upload'));
  assert.match(result.commands, /git push origin refs\/tags\/v0.1.0/);
  assert.match(result.commands, /gh release create v0.1.0 --draft --verify-tag/);
  assert.match(result.commands, /gh release upload v0.1.0 .*Y-Term-darwin-arm64-0.1.0.zip .*Y-Term-darwin-arm64-0.1.0.dmg --clobber/);
  assert.ok(result.commands.indexOf('gh release upload') < result.commands.indexOf('gh release edit'));
  assert.match(result.commands, /gh release edit v0.1.0 --draft=false --latest/);
});

for (const mode of ['public', 'dirty', 'failed-build', 'missing-dmg', 'rejected', 'unstapled']) {
  test(`release stops without publishing for ${mode}`, () => {
    const result = release(mode);
    assert.notEqual(result.status, 0, result.output);
    assert.doesNotMatch(result.commands, /git push|gh release (create|upload|edit)/);
  });
}
