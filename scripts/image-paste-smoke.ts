import type { ElectronApplication, Page } from 'playwright';
import assert from 'node:assert/strict';

/** Verify native Edit > Paste reaches only the focused terminal, exactly once. */
export async function verifyImagePaste(application: ElectronApplication, page: Page): Promise<void> {
  const saved = await application.evaluate(({ clipboard }) => clipboard.availableFormats().map(format => ({
    format, data: clipboard.readBuffer(format).toString('base64'),
  })));
  await application.evaluate(({ ipcMain }) => {
    const state = { writes: [] as { id: string; data: string }[], listener: (_event: unknown, id: string, data: string) => { state.writes.push({ id, data }); } };
    (globalThis as any).imagePasteSmoke = state;
    ipcMain.on('terminal:write', state.listener);
  });
  const takeWrites = async () => {
    await page.evaluate(() => window.terminal.getPreferences());
    return application.evaluate(() => (globalThis as any).imagePasteSmoke.writes.splice(0) as { id: string; data: string }[]);
  };
  try {
    await page.locator('[role=tabpanel]:not([hidden]) .xterm-helper-textarea').focus();
    await page.keyboard.press('Control+u');
    const [{ id }] = await takeWrites();
    await application.evaluate(({ clipboard, nativeImage }) => {
      clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')));
    });
    for (let index = 0; index < 2; index++) {
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.paste());
      await page.waitForTimeout(100);
      assert.deepEqual(await takeWrites(), [{ id, data: '\x16' }]);
    }
    await page.getByRole('button', { name: 'New tab', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[role=tabpanel]:not([hidden])')?.getAttribute('data-ready') === 'true');
    await page.locator('[role=tabpanel]:not([hidden]) .xterm-helper-textarea').focus();
    await page.keyboard.press('Control+u');
    const [{ id: secondId }] = await takeWrites();
    assert.notEqual(secondId, id);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.paste());
    await page.waitForTimeout(100);
    assert.deepEqual(await takeWrites(), [{ id: secondId, data: '\x16' }]);
    await page.locator('.tab:has([aria-selected=true])').getByRole('button', { name: 'Close tab' }).click();
    await page.locator('[role=tabpanel]:not([hidden]) .xterm-helper-textarea').focus();
    await page.keyboard.press('Control+u');
    await takeWrites();
    await application.evaluate(({ clipboard, BrowserWindow }) => {
      clipboard.writeText('image paste text regression');
      BrowserWindow.getAllWindows()[0].webContents.paste();
    });
    await page.waitForTimeout(100);
    const writes = await takeWrites();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].id, id);
    assert.ok(writes[0].data.includes('image paste text regression'));
    assert.ok(!writes[0].data.includes('\x16'));
    await page.keyboard.press('Control+u');
  } finally {
    await application.evaluate(({ clipboard, ipcMain }, saved) => {
      const state = (globalThis as any).imagePasteSmoke;
      ipcMain.removeListener('terminal:write', state.listener);
      delete (globalThis as any).imagePasteSmoke;
      clipboard.clear();
      for (const { format, data } of saved) clipboard.writeBuffer(format, Buffer.from(data, 'base64'));
    }, saved);
  }
}
