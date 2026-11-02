import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';

export async function verifySessionDirectories(page: Page): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'y-term-directory-'));
  const folder = join(directory, 'project folder');
  const matchingFolder = join(directory, 'other', 'project folder');
  await mkdir(folder);
  await mkdir(matchingFolder, { recursive: true });
  const originalCwd = await page.locator('#active-directory').textContent();
  const quote = (path: string) => `'${path.replaceAll("'", "'\\''")}'`;
  const command = async (value: string) => {
    await page.locator('[role=tabpanel]:not([hidden]) .xterm-helper-textarea').focus();
    await page.keyboard.type(value);
    await page.keyboard.press('Enter');
  };
  try {
    await command(`cd ${quote(folder)}; printf '\\033]2;Codex working\\007'; read -r yterm_directory_input`);
    await page.waitForFunction(() => document.querySelector('[aria-selected=true] .tab-directory')?.textContent === 'project folder');
    assert.equal(await page.locator('[aria-selected=true] .tab-label').textContent(), 'Codex working');
    const titleBox = await page.locator('[aria-selected=true] .tab-label').boundingBox();
    const directoryBox = await page.locator('[aria-selected=true] .tab-directory').boundingBox();
    assert.ok(titleBox && directoryBox && directoryBox.y >= titleBox.y + titleBox.height, 'directory must be on a separate line');
    assert.equal(await page.locator('#active-directory').textContent(), await realpath(folder));

    const tabIds = () => page.locator('[role=tab]').evaluateAll(tabs => tabs.map(tab => tab.id));
    const directoryOf = (id: string | null) => page.locator(`.tab:has([id="${id}"]) .tab-directory`).textContent();
    const firstId = await page.locator('[role=tab][aria-selected=true]').getAttribute('id');
    await page.getByRole('button', { name: 'New tab', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[role=tabpanel][data-ready=true]').length === 2);
    const secondId = await page.locator('[role=tab][aria-selected=true]').getAttribute('id');
    await page.waitForFunction(() => document.querySelector('[aria-selected=true] .tab-directory')?.textContent === 'project folder');
    await command('cd /');
    await page.waitForFunction(() => document.querySelector('[aria-selected=true] .tab-directory')?.textContent === '/');
    assert.equal(await directoryOf(firstId), 'project folder', 'inactive tabs retain their own directory');
    assert.deepEqual(await tabIds(), [secondId, firstId], 'sessions must be sorted by directory name');
    await page.locator(`[id="${firstId}"]`).click();
    await page.getByRole('button', { name: 'New tab', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[role=tabpanel][data-ready=true]').length === 3);
    const thirdId = await page.locator('[role=tab][aria-selected=true]').getAttribute('id');
    assert.deepEqual(await tabIds(), [secondId, firstId, thirdId], 'later sessions must join the matching directory');
    await page.locator(`[id="${firstId}"]`).click();
    await page.locator(`[id="${firstId}"]`).press('ArrowDown');
    assert.equal(await page.locator('[role=tab][aria-selected=true]').getAttribute('id'), thirdId,
      'keyboard navigation must follow the sorted order');
    await page.locator(`[id="${secondId}"]`).click();
    await command(`cd ${quote(matchingFolder)}`);
    await page.waitForFunction(() => [...document.querySelectorAll('.tab-directory')].every(tab => tab.textContent === 'project folder'));
    await page.locator(`[id="${thirdId}"]`).click();
    await command('cd /');
    await page.waitForFunction(() => document.querySelector('[aria-selected=true] .tab-directory')?.textContent === '/');
    assert.deepEqual(await tabIds(), [thirdId, secondId, firstId], 'directory changes must re-sort sessions');
    await page.locator('.tab:has([aria-selected=true]) .tab-close').click();
    await page.locator(`.tab:has([id="${secondId}"]) .tab-close`).click();
    await page.locator('[role=tabpanel]:not([hidden]) .xterm-helper-textarea').focus();
    await page.keyboard.press('Enter'); // Finish read in the original shell.
    await command(`cd ${quote(originalCwd!)}; printf '\\033]2;Directory check complete\\007'; read -r yterm_directory_input`);
    await page.waitForFunction(cwd => document.querySelector('#active-directory')?.textContent === cwd, originalCwd);
    await page.keyboard.press('Enter');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
