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

    await page.getByRole('button', { name: 'New tab', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[role=tabpanel][data-ready=true]').length === 2);
    await page.waitForFunction(() => document.querySelectorAll('.tab-directory')[1]?.textContent === 'project folder');
    await command('cd /');
    await page.waitForFunction(() => document.querySelectorAll('.tab-directory')[1]?.textContent === '/');
    assert.equal(await page.locator('.tab-directory').first().textContent(), 'project folder', 'inactive tabs retain their own directory');
    const firstId = await page.locator('[role=tab]').first().getAttribute('id');
    const secondId = await page.locator('[role=tab]').last().getAttribute('id');
    await page.locator(`[id="${firstId}"]`).click();
    await page.getByRole('button', { name: 'New tab', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[role=tabpanel][data-ready=true]').length === 3);
    const thirdId = await page.locator('[role=tab][aria-selected=true]').getAttribute('id');
    assert.deepEqual(await page.locator('[role=tab]').evaluateAll(tabs => tabs.map(tab => tab.id)),
      [firstId, thirdId, secondId], 'later sessions must join the matching directory group');
    await page.locator(`[id="${thirdId}"]`).press('ArrowDown');
    assert.equal(await page.locator('[role=tab][aria-selected=true]').getAttribute('id'), secondId,
      'keyboard navigation must follow the grouped order');
    await command(`cd ${quote(matchingFolder)}`);
    await page.waitForFunction(() => [...document.querySelectorAll('.tab-directory')].every(tab => tab.textContent === 'project folder'));
    await page.locator(`[id="${thirdId}"]`).click();
    await command('cd /');
    await page.waitForFunction(() => document.querySelector('[aria-selected=true] .tab-directory')?.textContent === '/');
    assert.deepEqual(await page.locator('[role=tab]').evaluateAll(tabs => tabs.map(tab => tab.id)),
      [firstId, secondId, thirdId], 'directory changes must regroup sessions');
    await page.locator('.tab:has([aria-selected=true]) .tab-close').click();
    await page.getByRole('button', { name: 'Close tab' }).last().click();
    await page.locator('[role=tabpanel]:not([hidden]) .xterm-helper-textarea').focus();
    await page.keyboard.press('Enter'); // Finish read in the original shell.
    await command(`cd ${quote(originalCwd!)}; printf '\\033]2;Directory check complete\\007'; read -r yterm_directory_input`);
    await page.waitForFunction(cwd => document.querySelector('#active-directory')?.textContent === cwd, originalCwd);
    await page.keyboard.press('Enter');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
