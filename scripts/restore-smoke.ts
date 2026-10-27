import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'y-term-restore-')));
const data = join(root, 'data'), zdotdir = join(root, 'zdotdir'), output = join(root, 'claude-args');
const first = join(root, 'alpha'), second = join(root, 'beta');
for (const directory of [data, zdotdir, first, second]) mkdirSync(directory);
// A shell function stands in for Claude so the smoke test never starts a real agent.
writeFileSync(join(zdotdir, '.zshrc'), `claude() { print -r -- "$PWD $*" > ${JSON.stringify(output)} }\n`);
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const id = '0b6c2f0e-3d4a-4c1b-9e8f-1a2b3c4d5e6f';
const snapshot = join(data, 'restore-after-update.json');
writeFileSync(snapshot, JSON.stringify({ version, windows: [{
  bounds: { x: 40, y: 40, width: 1000, height: 700 }, active: 1,
  tabs: [{ cwd: first }, { cwd: second, resume: { agent: 'claude', id } }],
}] }));
const env = { ...process.env, Y_TERM_TEST_DATA: data, SHELL: '/bin/zsh', ZDOTDIR: zdotdir };

try {
  let application = await electron.launch({ args: ['.'], env });
  try {
    const page = await application.firstWindow();
    await page.waitForFunction(() => document.querySelectorAll('[role=tabpanel][data-ready=true]').length === 2);
    assert.equal(existsSync(snapshot), false, 'the snapshot is used only once');
    assert.deepEqual(await page.getByRole('tab').evaluateAll(tabs => tabs.map(tab => tab.querySelector('.tab-directory')?.textContent)), ['alpha', 'beta']);
    assert.equal(await page.getByRole('tab').nth(1).getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#active-directory').textContent(), second);
    await page.waitForFunction(() => document.getElementById('message')?.textContent?.startsWith('Reopened 2 tabs'));
    assert.equal(await page.locator('#message').textContent(), 'Reopened 2 tabs after updating and resumed Claude sessions.');
    const deadline = Date.now() + 10_000;
    while (!existsSync(output) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(readFileSync(output, 'utf8').trim(), `${second} --resume ${id}`);
  } finally { await application.close(); }

  application = await electron.launch({ args: ['.'], env });
  try {
    const page = await application.firstWindow();
    await page.waitForFunction(() => document.querySelector('[role=tabpanel]')?.getAttribute('data-ready') === 'true');
    assert.equal(await page.getByRole('tab').count(), 1, 'a normal launch opens one fresh tab');
  } finally { await application.close(); }
  console.log('Restore smoke test passed.');
} finally { rmSync(root, { recursive: true, force: true }); }
