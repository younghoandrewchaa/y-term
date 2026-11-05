import assert from 'node:assert/strict';
import type { ElectronApplication, Page } from 'playwright';

export async function verifyTabShortcuts(application: ElectronApplication, page: Page): Promise<void> {
  const tabIds = () => page.locator('[role=tab]').evaluateAll(tabs => tabs.map(tab => tab.id));
  const selected = () => page.locator('[role=tab][aria-selected=true]').getAttribute('id');
  const send = (command: string) => application.evaluate(({ BrowserWindow }, value) =>
    BrowserWindow.getAllWindows()[0].webContents.send('terminal:action', value), command);
  const numbersShown = () => page.locator('#sidebar').evaluate(node => node.hasAttribute('data-show-tab-numbers'));
  const waitNumbers = (shown: boolean) => page.waitForFunction(value =>
    document.querySelector('#sidebar')?.hasAttribute('data-show-tab-numbers') === value, shown);
  const focusTerminal = () => page.locator('[role=tabpanel]:not([hidden]) .xterm-helper-textarea').focus();

  const opened: string[] = [];
  while ((await tabIds()).length < 3) {
    const count = (await tabIds()).length;
    await page.getByRole('button', { name: 'New tab', exact: true }).click();
    await page.waitForFunction(value => document.querySelectorAll('[role=tabpanel][data-ready=true]').length === value, count + 1);
    opened.push((await selected())!);
  }
  const ids = await tabIds();
  assert.ok(ids.length < 8, 'this check assumes fewer than eight tabs');

  const accelerators = await application.evaluate(({ Menu }) => Array.from({ length: 9 }, (_, index) =>
    Menu.getApplicationMenu()?.getMenuItemById(`select-tab-${index + 1}`)?.accelerator));
  assert.deepEqual(accelerators, Array.from({ length: 9 }, (_, index) => `Cmd+${index + 1}`));

  await send('select-tab-1');
  await page.waitForFunction(id => document.querySelector('[role=tab][aria-selected=true]')?.id === id, ids[0]);
  await send('select-tab-9');
  await page.waitForFunction(id => document.querySelector('[role=tab][aria-selected=true]')?.id === id, ids[ids.length - 1]);
  await send(`select-tab-${ids.length + 1}`);
  await page.waitForTimeout(100);
  assert.equal(await selected(), ids[ids.length - 1], 'a digit with no tab must do nothing');

  await focusTerminal();
  await page.keyboard.down('Meta');
  await waitNumbers(true);
  const numbers = await page.locator('.tab-number').evaluateAll(nodes => nodes.map(node =>
    getComputedStyle(node).display === 'none' ? '' : node.textContent));
  assert.deepEqual(numbers, ids.map((_, index) => String(index + 1)), 'holding ⌘ must number the tabs');
  await page.keyboard.up('Meta');
  await waitNumbers(false);

  await page.keyboard.down('Meta');
  await page.keyboard.press('Shift');
  await page.waitForTimeout(400);
  assert.equal(await numbersShown(), false, 'another key must cancel the numbers');
  await page.keyboard.up('Meta');

  await page.keyboard.down('Meta');
  await waitNumbers(true);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await waitNumbers(false);
  await page.keyboard.up('Meta');

  for (const id of opened) await page.locator(`.tab:has([id="${id}"]) .tab-close`).click();
}
