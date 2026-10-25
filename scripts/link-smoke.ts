import type { Dialog, ElectronApplication, Page } from 'playwright';
import assert from 'node:assert/strict';

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
}
