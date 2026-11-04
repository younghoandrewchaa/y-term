import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';

export async function verifyBranchDelete(application: ElectronApplication, page: Page): Promise<void> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'y-term-branch-')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root }).toString();
  const panel = '[role=tabpanel]:not([hidden])';
  const command = async (value: string) => {
    await page.locator(`${panel} .xterm-helper-textarea`).focus();
    await page.keyboard.type(value);
    await page.keyboard.press('Enter');
  };
  // Native confirmations are answered with the destructive button and recorded.
  await application.evaluate(({ dialog }) => {
    const state = { messages: [] as string[], original: dialog.showMessageBox };
    (globalThis as unknown as { branchSmoke: typeof state }).branchSmoke = state;
    dialog.showMessageBox = (async (_window: unknown, options: { message: string }) => {
      state.messages.push(options.message);
      return { response: 1, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
  try {
    git('init', '-q'); git('config', 'user.email', 'smoke@example.invalid'); git('config', 'user.name', 'Smoke'); git('config', 'core.pager', 'cat');
    await writeFile(join(root, 'file'), 'base\n'); git('add', '.'); git('commit', '-qm', 'base');
    git('branch', 'smoke-merged'); git('branch', 'smoke-other');
    const original = await page.locator('#active-directory').textContent();
    await command(`cd '${root}' && clear`);
    await command('git branch');
    const buttons = page.locator(`${panel} .branch-delete`);
    await buttons.nth(1).waitFor();
    assert.equal(await buttons.count(), 2, 'only branches that are not checked out get a button');
    const copies = page.locator(`${panel} .branch-copy`);
    assert.equal(await copies.count(), 2, 'each branch action includes a copy button');
    await page.locator(`${panel} .branch-copy[title="Copy branch smoke-merged"]`).click();
    await page.locator(`${panel} .branch-copy[title="Copied branch smoke-merged"]`).waitFor();
    assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), 'smoke-merged');
    assert.notEqual(git('branch', '--list', 'smoke-merged'), '', 'copying leaves the branch intact');
    await page.locator(`${panel} .branch-delete[title="Delete branch smoke-merged"]`).click();
    await page.locator(`${panel} .branch-deleted`).waitFor();
    assert.equal(await buttons.count(), 1);
    assert.equal(await copies.count(), 1, 'deleting a branch removes both actions');
    assert.equal(git('branch', '--list', 'smoke-merged'), '');
    assert.notEqual(git('branch', '--list', 'smoke-other'), '');
    const messages = await application.evaluate(() => (globalThis as unknown as { branchSmoke: { messages: string[] } }).branchSmoke.messages);
    assert.deepEqual(messages, ['Delete branch smoke-merged?']);
    await command('cd - > /dev/null && clear');
    await page.waitForFunction(cwd => document.querySelector('#active-directory')?.textContent === cwd, original);
  } finally {
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = (globalThis as unknown as { branchSmoke: { original: typeof dialog.showMessageBox } }).branchSmoke.original;
    });
    await rm(root, { recursive: true, force: true });
  }
}
