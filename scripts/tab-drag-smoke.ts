import assert from 'node:assert/strict';
import type { ElectronApplication, Page } from 'playwright';

export async function verifyTabDrag(application: ElectronApplication, page: Page): Promise<void> {
  const tabIds = () => page.locator('[role=tab]').evaluateAll(tabs => tabs.map(tab => tab.id));
  const selected = () => page.locator('[role=tab][aria-selected=true]').getAttribute('id');
  const numbers = () => page.locator('.tab-number').evaluateAll(nodes => nodes.map(node => node.textContent));
  const send = (command: string) => application.evaluate(({ BrowserWindow }, value) =>
    BrowserWindow.getAllWindows()[0].webContents.send('terminal:action', value), command);
  const noDragMarks = async () => assert.equal(await page.locator('[data-drop], [data-dragging]').count(), 0, 'a finished drag must leave no marks');
  const tab = (index: number) => page.locator('.tab').nth(index);

  const opened: string[] = [];
  while ((await tabIds()).length < 3) {
    const count = (await tabIds()).length;
    await page.getByRole('button', { name: 'New tab', exact: true }).click();
    await page.waitForFunction(value => document.querySelectorAll('[role=tabpanel][data-ready=true]').length === value, count + 1);
    opened.push((await selected())!);
  }
  const ids = await tabIds();
  assert.equal(ids.length, 3, 'this check assumes three tabs');
  const before = await selected();

  // Lower half of the third tab: the first tab lands after it.
  await tab(0).dragTo(tab(2), { targetPosition: { x: 40, y: 44 } });
  assert.deepEqual(await tabIds(), [ids[1], ids[2], ids[0]], 'dragging down must move the tab below its target');
  assert.equal(await selected(), before, 'moving a tab must not change the selection');
  assert.deepEqual(await numbers(), ['1', '2', '3'], 'the shortcut digits must follow the new order');
  await noDragMarks();

  // Upper half of the first tab: the last tab lands before it.
  await tab(2).dragTo(tab(0), { targetPosition: { x: 40, y: 8 } });
  assert.deepEqual(await tabIds(), [ids[0], ids[1], ids[2]], 'dragging up must move the tab above its target');
  await noDragMarks();

  // The drop line sits in the 4px gap between tabs, so releasing there must work too.
  const from = (await tab(2).boundingBox())!; const gapBelow = (await tab(1).boundingBox())!;
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(gapBelow.x + 40, gapBelow.y + gapBelow.height / 2, { steps: 5 });
  await page.mouse.move(gapBelow.x + 40, gapBelow.y - 2, { steps: 3 });
  await page.mouse.up();
  assert.deepEqual(await tabIds(), [ids[0], ids[2], ids[1]], 'dropping in the gap between tabs must move the tab there');
  await noDragMarks();
  await tab(1).dragTo(tab(2), { targetPosition: { x: 40, y: 44 } });
  assert.deepEqual(await tabIds(), ids);

  // A tab dropped on the terminal is not a move and must paste nothing.
  const rows = page.locator('[role=tabpanel]:not([hidden]) .xterm-rows');
  const text = await rows.textContent();
  await tab(0).dragTo(page.locator('[role=tabpanel]:not([hidden]) .xterm-screen'));
  await page.waitForTimeout(200);
  assert.deepEqual(await tabIds(), ids, 'dropping on the terminal must not reorder tabs');
  assert.equal(await rows.textContent(), text, 'dropping a tab on the terminal must not paste anything');
  await noDragMarks();

  // ⌘1 picks whichever tab is first now.
  await tab(1).dragTo(tab(0), { targetPosition: { x: 40, y: 8 } });
  await send('select-tab-1');
  await page.waitForFunction(id => document.querySelector('[role=tab][aria-selected=true]')?.id === id, ids[1]);

  for (const id of opened) await page.locator(`.tab:has([id="${id}"]) .tab-close`).click();
}
