import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UpdateState } from '../src/shared/update-protocol.ts';

const directory = await mkdtemp(join(tmpdir(), 'y-term-update-'));
const application = await electron.launch({ args: ['.'], env: { ...process.env, Y_TERM_TEST_DATA: directory } });
try {
  const page = await application.firstWindow();
  const version = await application.evaluate(({ app }) => app.getVersion());
  await page.waitForFunction(() => document.querySelector('[role=tabpanel]')?.getAttribute('data-ready') === 'true');
  assert.equal(await page.locator('#app-version').textContent(), `v${version}`);
  assert.equal(await page.locator('#update-check').isVisible(), false);
  assert.equal(await page.locator('#update-button').isVisible(), false);
  const publish = async (state: UpdateState) => {
    await application.evaluate(({ BrowserWindow }, value) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('updates:state', value);
    }, state);
    await page.waitForFunction(status => document.getElementById('app-updates')?.dataset.status === status, state.status);
  };
  await application.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('updates:check');
    ipcMain.handle('updates:check', event => {
      event.sender.send('updates:state', { version: '0.1.3', status: 'checking' });
      event.sender.send('updates:state', { version: '0.1.3', status: 'idle' });
      return { version: '0.1.3', status: 'idle' };
    });
    ipcMain.removeHandler('updates:install');
    ipcMain.handle('updates:install', event => {
      event.sender.send('updates:state', { version: '0.1.3', status: 'downloading', latestVersion: '0.2.0' });
    });
  });
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate(async value => {
      await window.terminal.savePreferences({ ...await window.terminal.getPreferences(), theme: value });
    }, theme);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[role=tabpanel]')?.getAttribute('data-ready') === 'true');
    await publish({ version, status: 'idle' });
    assert.equal(await page.locator('#update-status').isVisible(), false);
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await page.waitForFunction(() => document.getElementById('update-status')?.textContent === 'Y-Term is up to date');
    assert.equal(await page.locator('#update-check').isEnabled(), true);
    const shownAt = Date.now();
    await page.waitForFunction(() => document.getElementById('update-status')?.hidden, undefined, { timeout: 6500 });
    assert.ok(Date.now() - shownAt >= 4900, 'Up-to-date feedback should remain visible for five seconds');
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await page.waitForFunction(() => document.getElementById('update-status')?.textContent === 'Y-Term is up to date');
    await publish({ version, status: 'checking' });
    assert.equal(await page.locator('#update-check').isDisabled(), true);
    await publish({ version, status: 'idle' });
    assert.equal(await page.locator('#update-status').isVisible(), false);
    await publish({ version, status: 'available', latestVersion: '0.2.0' });
    assert.equal(await page.locator('#update-status').textContent(), 'Version 0.2.0 available');
    await page.screenshot({ path: join(tmpdir(), `y-term-update-${theme}.png`) });
    await page.getByRole('button', { name: 'Update', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('app-updates')?.dataset.status === 'downloading');
    assert.equal(await page.locator('#update-button').isDisabled(), true);
    assert.equal(await page.locator('#update-status').textContent(), 'Downloading update…');
    await publish({ version, status: 'error', latestVersion: '0.2.0', message: 'Update failed. Try again.' });
    assert.equal(await page.locator('#update-button').textContent(), 'Retry update');
    assert.equal(await page.locator('#update-button').isEnabled(), true);
    await publish({ version, status: 'error', message: 'Could not check for updates.' });
    assert.equal(await page.locator('#update-button').textContent(), 'Retry check');
    await publish({ version, status: 'installing', latestVersion: '0.2.0' });
    assert.equal(await page.locator('#update-status').textContent(), 'Installing and restarting…');
  }
  await publish({ version, status: 'disabled' });
  assert.equal(await page.locator('#update-button').isVisible(), false);
  assert.equal(await page.locator('#update-check').isVisible(), false);
  assert.equal(await page.locator('[role=tab]').count(), 1);
  const opened = application.waitForEvent('window');
  await application.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()!.items.find(item => item.label === 'Shell')!.submenu!.items.find(item => item.label === 'New Window')!;
    (item.click as () => void)();
  });
  const second = await opened;
  await second.waitForFunction(() => document.getElementById('app-version')?.textContent?.startsWith('v'));
  assert.equal(await second.locator('#app-version').textContent(), `v${version}`);
  await publish({ version, status: 'available', latestVersion: '0.2.0' });
  await second.waitForFunction(() => document.getElementById('app-updates')?.dataset.status === 'available');
  assert.equal(await second.locator('#update-status').textContent(), 'Version 0.2.0 available');
  await second.close();
  console.log('PASS: sidebar version, manual check, update notice, click, busy states, retries, both themes and multiple windows; no real downloads.');
} finally {
  await application.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
