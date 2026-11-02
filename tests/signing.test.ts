import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';

test('release signing skips locale data after signer validation and still signs code', async () => {
  const require = createRequire(import.meta.url);
  const previous = process.env.Y_TERM_RELEASE;
  process.env.Y_TERM_RELEASE = '1';
  let signing;
  try {
    signing = require('../forge.config.cjs').packagerConfig.osxSign;
  } finally {
    if (previous === undefined) delete process.env.Y_TERM_RELEASE;
    else process.env.Y_TERM_RELEASE = previous;
  }
  const root = mkdtempSync(join(tmpdir(), 'y-term-signing-'));
  const app = join(root, 'Y-Term.app');
  const framework = join(app, 'Contents/Frameworks/Electron Framework.framework');
  const locales = ['bn_MASCULINE', 'bn_NEUTER', 'ca', 'cs_FEMININE'].map(locale =>
    join(framework, `Versions/A/Resources/${locale}.lproj/locale.pak`));
  const binaries = [join(app, 'Contents/MacOS/Y-Term'),
    join(framework, 'Versions/A/Electron Framework'),
    join(app, 'Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node'),
    join(app, 'Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper')];
  const util = require('@electron/osx-sign/dist/cjs/util.js');
  const originalExec = util.execFileAsync;
  const signed: string[] = [];
  // Keep the real walk, option validation, and signing decisions; replace only OS commands.
  util.execFileAsync = async (command: string, args: string[]) => {
    if (command === 'codesign' && args.includes('--sign')) signed.push(args.at(-1)!);
    return '';
  };
  try {
    for (const path of [...locales, ...binaries]) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.alloc(1024));
    }
    await require('@electron/osx-sign').signApp({
      ...signing, app, platform: 'darwin', identity: 'Test', identityValidation: false,
      preAutoEntitlements: false, preEmbedProvisioningProfile: false,
    });
    for (const locale of locales) assert.ok(!signed.includes(locale), `Signed locale: ${locale}`);
    for (const binary of [...binaries, framework, app]) assert.ok(signed.includes(binary), `Skipped code: ${binary}`);
  } finally {
    util.execFileAsync = originalExec;
    rmSync(root, { recursive: true, force: true });
  }
});
