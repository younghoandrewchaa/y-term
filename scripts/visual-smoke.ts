import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';

/** Exercise the redesign through the real renderer, settings, and shells. */
export async function verifyVisualDesign(application: ElectronApplication, page: Page): Promise<void> {
  const screenshotDirectory = process.env.Y_TERM_SCREENSHOTS;
  if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
  const screenshot = async (name: string) => {
    if (screenshotDirectory) await page.screenshot({ path: join(screenshotDirectory, `${name}.png`) });
  };
  const resize = async (width: number, height: number) => {
    await application.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0].setSize(size.width, size.height);
    }, { width, height });
    await page.waitForFunction(size => innerWidth === size.width && innerHeight === size.height, { width, height });
  };
  const ready = () => page.waitForFunction(() => document.querySelector('[role=tabpanel]:not([hidden])')?.getAttribute('data-ready') === 'true');
  // Start the visual checks in a clean shell; the file-drop checks deliberately
  // leave an error banner and a temporary working directory in the old session.
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await ready();
  await page.locator('.tab').first().hover();
  await page.locator('.tab').first().getByRole('button', { name: 'Close tab', exact: true }).click();
  await resize(1200, 760);
  const sidebar = await page.locator('.sidebar').boundingBox();
  const terminal = await page.locator('[role=tabpanel]:not([hidden]) .terminal-host').boundingBox();
  assert.ok(sidebar && terminal && sidebar.width === 232 && terminal.x > sidebar.width);
  assert.equal(await page.locator('#tabs').getAttribute('aria-orientation'), 'vertical');
  assert.equal(await page.locator('#session-count').textContent(), '1');
  await page.locator('[role=tabpanel]:not([hidden]) .xterm-helper-textarea').focus();
  await page.keyboard.type("clear; pwd; ls; printf '\\033]2;Y-Term visual check\\007'");
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as unknown as { smokeOutput: string }).smokeOutput.includes('\x1b]2;Y-Term visual check\x07'));
  await screenshot('dark');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await screenshot('settings-dark');
  await page.locator('select[name=theme]').selectOption('light');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light' && !document.querySelector('dialog[open]'));
  assert.equal(await page.locator('.sidebar').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(240, 239, 236)');
  assert.equal(await page.locator('.xterm-viewport').last().evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(250, 249, 246)');
  await screenshot('light');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('select[name=theme]').selectOption('dark');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && !document.querySelector('dialog[open]'));

  // Playwright's synthetic key events do not reliably invoke macOS native menu
  // accelerators. Exercise the same action channel as the Find menu instead.
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('terminal:action', 'find');
  });
  await page.locator('#find-input').fill('unlikely_yterm_search_text');
  await page.waitForFunction(() => document.querySelector('#find-status')?.textContent === 'No match');
  await screenshot('search');
  await page.locator('#find-input').press('Escape');
  await page.locator('#find-bar').waitFor({ state: 'hidden' });

  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await ready();
  await page.locator('[role=tab]').last().focus();
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('[role=tab]').first().getAttribute('aria-selected'), 'true');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('[role=tab]').last().getAttribute('aria-selected'), 'true');
  await page.locator('[role=tabpanel]:not([hidden]) .xterm-helper-textarea').focus();
  // A shell-supplied title must remain text, preserve its icon, and truncate.
  await page.keyboard.type("printf '\\033]2;A very long session title with <markup> and enough text to overflow the sidebar\\007'; read -r yterm_visual_input");
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[aria-selected=true] .tab-label')?.textContent?.startsWith('A very long session title'));
  assert.equal(await page.locator('#active-title').textContent(), await page.locator('[aria-selected=true] .tab-label').textContent());
  assert.equal(await page.locator('[aria-selected=true] svg').count(), 1);
  assert.equal(await page.locator('.tab-label markup').count(), 0);
  await resize(640, 400);
  const smallTerminal = await page.locator('[role=tabpanel]:not([hidden]) .terminal-host').boundingBox();
  assert.ok(smallTerminal && smallTerminal.width >= 400 && smallTerminal.height >= 280);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth), true);
  await screenshot('minimum-size');

  for (let index = 0; index < 8; index++) {
    await page.getByRole('button', { name: 'New tab', exact: true }).click();
    await ready();
  }
  assert.equal(await page.locator('#tabs').evaluate(node => node.scrollHeight > node.clientHeight), true);
  const settings = await page.locator('#settings-open').boundingBox();
  assert.ok(settings && settings.y + settings.height <= 400);
  await page.locator('[role=tab]').last().focus();
  await page.keyboard.press('Home');
  assert.equal(await page.locator('[role=tab]').first().getAttribute('aria-selected'), 'true');
  await page.keyboard.press('End');
  assert.equal(await page.locator('[role=tab]').last().getAttribute('aria-selected'), 'true');
  await screenshot('many-sessions');
  while (await page.locator('[role=tab]').count()) {
    const selected = page.locator('.tab:has([aria-selected=true])');
    await selected.hover();
    await selected.getByRole('button', { name: 'Close tab', exact: true }).click();
  }
  assert.equal(await page.locator('#empty-state').isVisible(), true);
  assert.equal(await page.locator('#session-count').textContent(), '0');
  assert.equal(await page.locator('#active-title').textContent(), 'Y-Term');
  await resize(1200, 760);
  await screenshot('empty-state');
  await page.locator('#empty-new-tab').click();
  await ready();
  assert.equal(await page.locator('#empty-state').isVisible(), false);
  assert.equal(await page.locator('[role=tab]').count(), 1);
}
