import assert from 'node:assert/strict';
import type { ElectronApplication, Page } from 'playwright';

export async function verifySidebarResize(application: ElectronApplication, page: Page): Promise<void> {
  const sidebar = page.locator('.sidebar');
  const divider = page.getByRole('separator', { name: 'Resize sidebar' });
  const width = () => sidebar.evaluate(node => node.getBoundingClientRect().width);
  const waitWidth = (expected: number) => page.waitForFunction(value =>
    document.querySelector('.sidebar')?.getBoundingClientRect().width === value, expected);
  const drag = async (target: number) => {
    const box = await divider.boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + target - await width(), box.y + 120, { steps: 8 });
    await page.mouse.up();
  };
  const previousScreen = await page.locator('.xterm-screen').last().boundingBox();
  await drag(360);
  await waitWidth(360);
  await page.waitForFunction(previous => {
    const screen = document.querySelector('.xterm-screen')?.getBoundingClientRect();
    return screen && screen.width < previous;
  }, previousScreen!.width);
  await page.waitForFunction(async () => (await window.terminal.getPreferences()).sidebarWidth === 360);
  assert.equal(await page.locator('body').evaluate(node => node.classList.contains('resizing-sidebar')), false);

  await divider.focus();
  await divider.press('ArrowLeft');
  await waitWidth(350);
  await divider.press('End');
  await waitWidth(480);
  await divider.press('Home');
  await waitWidth(180);
  await drag(5);
  await waitWidth(180);
  await drag(1000);
  await waitWidth(480);
  await drag(360);
  await page.waitForFunction(async () => (await window.terminal.getPreferences()).sidebarWidth === 360);

  // A fresh renderer must restore the saved preference.
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[role=tabpanel]')?.getAttribute('data-ready') === 'true');
  await waitWidth(360);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 400));
  await page.waitForFunction(() => innerWidth === 640);
  assert.ok(await width() <= 208, 'narrow windows must retain 400px of terminal content');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth), true);
  assert.equal((await page.evaluate(() => window.terminal.getPreferences())).sidebarWidth, 360);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 760));
  await waitWidth(360);
  await divider.dblclick();
  await waitWidth(232);
}
