import type { Dialog, ElectronApplication, Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function verifyLinks(application: ElectronApplication, page: Page): Promise<void> {
  await application.evaluate(({ shell }) => {
    const state = { opened: [] as string[], original: shell.openExternal };
    (globalThis as any).linkSmoke = state;
    shell.openExternal = async url => { state.opened.push(url); };
  });
  const dialogs: string[] = [];
  const dismiss = (dialog: Dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); };
  page.on('dialog', dismiss);
  try {
    await page.locator('[role=tabpanel]:not([hidden]) .xterm-helper-textarea').focus();
    await page.keyboard.type("printf '\\033]8;;https://example.com/embedded\\033\\\\YTERM_LINK\\033]8;;\\033\\\\\\nhttps://example.com/plain\\n'");
    await page.keyboard.press('Enter');
    const rows = page.locator('[role=tabpanel]:not([hidden]) .xterm-rows > div');
    for (const text of ['YTERM_LINK', 'https://example.com/plain']) {
      const row = rows.filter({ hasText: new RegExp(`^${text.replaceAll('.', '\\.')}\\s*$`) });
      await row.waitFor();
      const box = await row.boundingBox();
      assert.ok(box);
      // Move first so xterm resolves the link provider before mouse down.
      await page.mouse.move(box.x + 20, box.y + box.height / 2);
      await page.waitForTimeout(150);
      await page.mouse.click(box.x + 20, box.y + box.height / 2);
      assert.deepEqual(dialogs, [], 'ordinary clicks must not show a warning');
      assert.equal(await application.evaluate(() => (globalThis as any).linkSmoke.opened.length), text === 'YTERM_LINK' ? 0 : 1);
      await page.keyboard.down('Meta');
      try { await page.mouse.click(box.x + 20, box.y + box.height / 2); }
      finally { await page.keyboard.up('Meta'); }
      await page.evaluate(() => window.terminal.getPreferences());
      assert.deepEqual(dialogs, [], 'Cmd+click must open without confirmation');
    }
    assert.deepEqual(await application.evaluate(() => (globalThis as any).linkSmoke.opened), [
      'https://example.com/embedded', 'https://example.com/plain',
    ]);
  } finally {
    page.off('dialog', dismiss);
    await application.evaluate(({ shell }) => {
      shell.openExternal = (globalThis as any).linkSmoke.original;
      delete (globalThis as any).linkSmoke;
    });
  }
  await verifyLocalFileLinks(application, page);
}

async function verifyLocalFileLinks(application: ElectronApplication, page: Page): Promise<void> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'y-term-links-')));
  await mkdir(join(directory, 'docs'));
  for (const name of ['plan.md', 'my plan.md', 'fail.md']) await writeFile(join(directory, 'docs', name), 'test');
  const originalCwd = await page.locator('#active-directory').textContent();
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const command = async (value: string) => {
    await page.locator('[role=tabpanel]:not([hidden]) .xterm-helper-textarea').focus();
    await page.keyboard.type(value);
    await page.keyboard.press('Enter');
  };
  await application.evaluate(({ shell }) => {
    const state = { opened: [] as string[], original: shell.openPath };
    (globalThis as any).fileLinkSmoke = state;
    shell.openPath = async path => { state.opened.push(path); return path.endsWith('/fail.md') ? 'YTERM_NO_DEFAULT_APP' : ''; };
  });
  try {
    const fileUrl = pathToFileURL(join(directory, 'docs/my plan.md')).href;
    await command(`cd ${quote(directory)}; printf '\\033[2J\\033[H'; printf '%s\\n' '(docs/plan.md).' '"docs/my plan.md"' ${quote(join(directory, 'docs/plan.md'))}; printf '\\033]8;;%s\\033\\\\YTERM_FILE_LINK\\033]8;;\\033\\\\\\n' ${quote(fileUrl)}`);
    const rows = page.locator('[role=tabpanel]:not([hidden]) .xterm-rows > div');
    for (const [index, text] of ['(docs/plan.md).', '"docs/my plan.md"', join(directory, 'docs/plan.md'), 'YTERM_FILE_LINK'].entries()) {
      // Absolute paths can wrap; click their first row and verify the full path opens.
      const prefix = text.startsWith('/') ? text.slice(0, 32) : text;
      const row = rows.filter({ hasText: new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${text.startsWith('/') ? '' : '\\s*$'}`) });
      await row.waitFor();
      const box = await row.boundingBox();
      assert.ok(box);
      await page.mouse.move(box.x + 20, box.y + box.height / 2);
      await page.waitForTimeout(150);
      await page.mouse.click(box.x + 20, box.y + box.height / 2);
      assert.equal(await application.evaluate(() => (globalThis as any).fileLinkSmoke.opened.length), index, 'ordinary clicks do not open files');
      await page.keyboard.down('Meta');
      try { await page.mouse.click(box.x + 20, box.y + box.height / 2); }
      finally { await page.keyboard.up('Meta'); }
      const deadline = Date.now() + 3000;
      while (await application.evaluate(() => (globalThis as any).fileLinkSmoke.opened.length) === index && Date.now() < deadline) await page.waitForTimeout(25);
      assert.equal(await application.evaluate(() => (globalThis as any).fileLinkSmoke.opened.length), index + 1);
    }
    assert.deepEqual(await application.evaluate(() => (globalThis as any).fileLinkSmoke.opened),
      ['plan.md', 'my plan.md', 'plan.md', 'my plan.md'].map(name => join(directory, 'docs', name)));
    await command("printf '\\033[2J\\033[Hdocs/fail.md\\n'");
    const failureRow = rows.filter({ hasText: /^docs\/fail\.md\s*$/ });
    await failureRow.waitFor();
    const box = await failureRow.boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.waitForTimeout(150);
    await page.keyboard.down('Meta');
    try { await page.mouse.click(box.x + 20, box.y + box.height / 2); }
    finally { await page.keyboard.up('Meta'); }
    await page.waitForFunction(() => document.querySelector('.session-status:not([hidden])')?.textContent?.includes('YTERM_NO_DEFAULT_APP'));
  } finally {
    await command(`cd ${quote(originalCwd!)}; printf 'YTERM_%s\\n' 'LINKS_CLEANED'`);
    await page.locator('[role=tabpanel]:not([hidden]) .xterm-rows > div').filter({ hasText: /^YTERM_LINKS_CLEANED\s*$/ }).waitFor();
    await page.waitForFunction(cwd => document.querySelector('#active-directory')?.textContent === cwd, originalCwd);
    await application.evaluate(({ shell }) => {
      shell.openPath = (globalThis as any).fileLinkSmoke.original;
      delete (globalThis as any).fileLinkSmoke;
    });
    await rm(directory, { recursive: true, force: true });
  }
}
