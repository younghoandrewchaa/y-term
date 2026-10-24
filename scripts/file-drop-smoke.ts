import type { ElectronApplication, Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface DropWrite { id: string; data: string }
interface DropState {
  writes: DropWrite[];
  listener: (event: unknown, id: string, data: string) => void;
}

/** Exercise the real context bridge and PTY channel, without mocking path lookup. */
export async function verifyFileDrops(application: ElectronApplication, page: Page, directory: string): Promise<void> {
  const paths = [join(directory, 'hello world.txt'), join(directory, "it's 한글 $();`&*.txt")];
  const folder = join(directory, 'a folder');
  await mkdir(folder);
  await Promise.all(paths.map(path => writeFile(path, 'drop fixture')));
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.hidden = true; input.id = 'drop-fixtures';
    document.body.append(input);
  });
  await page.locator('#drop-fixtures').setInputFiles(paths);
  assert.deepEqual(await page.evaluate(() => Array.from(
    (document.querySelector('#drop-fixtures') as HTMLInputElement).files!,
    file => window.terminal.getPathForFile(file),
  )), paths);
  assert.equal(await page.evaluate(() => window.terminal.getPathForFile(new File([], 'synthetic'))), '');

  await application.evaluate(({ ipcMain }) => {
    const state: DropState = { writes: [], listener: (_event, id, data) => { state.writes.push({ id, data }); } };
    (globalThis as unknown as { dropSmoke: DropState }).dropSmoke = state;
    ipcMain.on('terminal:write', state.listener);
  });
  const takeWrites = async () => {
    // Round-trip after fire-and-forget writes so the main process has seen them.
    await page.evaluate(() => window.terminal.getPreferences());
    return application.evaluate(() => (globalThis as unknown as { dropSmoke: DropState }).dropSmoke.writes.splice(0));
  };
  const drop = (selector: string, synthetic = false) => page.evaluate(({ selector, synthetic }) => {
    const transfer = new DataTransfer();
    const files = (document.querySelector('#drop-fixtures') as HTMLInputElement).files!;
    for (const file of synthetic ? [new File([], 'synthetic')] : Array.from(files)) transfer.items.add(file);
    const target = document.querySelector(selector)!;
    const dragover = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
    const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
    target.dispatchEvent(dragover); target.dispatchEvent(event);
    return { overPrevented: dragover.defaultPrevented, dropPrevented: event.defaultPrevented };
  }, { selector, synthetic });
  const activeScreen = '[role=tabpanel]:not([hidden]) .xterm-screen';
  const url = page.url();
  try {
    await page.locator('[role=tabpanel]:not([hidden]) .xterm-helper-textarea').focus();
    await page.keyboard.type("printf 'YTERM_%s:' DROP; printf '<%s>' ");
    const typed = await takeWrites();
    const targetId = typed.at(-1)!.id;
    assert.deepEqual(await drop(activeScreen), { overPrevented: true, dropPrevented: true });
    const writes = await takeWrites();
    assert.equal(writes.length, 1, 'one drop must produce exactly one paste');
    assert.equal(writes[0].id, targetId, 'the receiving tab must own the input');
    assert.doesNotMatch(writes[0].data, /[\r\n]/, 'a drop must not press Enter');
    assert.equal(await page.evaluate(() => (window as unknown as { smokeOutput: string }).smokeOutput.includes('YTERM_DROP:')), false);
    await page.keyboard.type("; printf '\\n'");
    await page.keyboard.press('Enter');
    await page.waitForFunction(expected => (window as unknown as { smokeOutput: string }).smokeOutput.includes(expected), `YTERM_DROP:<${paths[0]}><${paths[1]}>`);
    await takeWrites();

    // Hidden tabs, dialogs, and outside surfaces cannot consume a file drop.
    assert.deepEqual(await drop('[role=tabpanel][hidden] .xterm-screen'), { overPrevented: true, dropPrevented: true });
    await page.locator('#settings-open').click();
    await drop(activeScreen);
    await drop('#settings');
    await page.locator('#settings-cancel').click();
    await drop('#tabs');
    assert.deepEqual(await takeWrites(), []);
    assert.equal(page.url(), url);

    // Synthetic files have no native path and must not paste a guessed name.
    await drop(activeScreen, true);
    assert.deepEqual(await takeWrites(), []);
    assert.match(await page.locator('[role=tabpanel]:not([hidden]) .session-status').innerText(), /Cannot insert/);

    // Real filesystem directory File via Chromium's file-input primitive. Unlike
    // webkitdirectory, this represents the selected folder, not its children.
    const cdp = await page.context().newCDPSession(page);
    try {
      const { root } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#drop-fixtures' });
      await cdp.send('DOM.setFileInputFiles', { nodeId, files: [folder] });
      assert.equal(await page.evaluate(() => window.terminal.getPathForFile(
        (document.querySelector('#drop-fixtures') as HTMLInputElement).files![0],
      )), folder);
      await page.locator('[role=tabpanel]:not([hidden]) .xterm-helper-textarea').focus();
      await page.keyboard.type('cd ');
      await takeWrites();
      await drop(activeScreen);
      assert.equal((await takeWrites()).length, 1);
      await page.keyboard.type("; printf 'YTERM_%s:%s\\n' FOLDER \"$PWD\"");
      await page.keyboard.press('Enter');
      await page.waitForFunction(expected => (window as unknown as { smokeOutput: string }).smokeOutput.includes(expected), `YTERM_FOLDER:${folder}`);
    } finally { await cdp.detach(); }

    await page.getByRole('button', { name: 'New tab', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[role=tabpanel]:not([hidden])')?.getAttribute('data-ready') === 'true');
    await page.keyboard.type('exit');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[role=tabpanel]:not([hidden]) .session-status')?.textContent?.includes('Shell exited'));
    await takeWrites();
    await drop(activeScreen);
    assert.deepEqual(await takeWrites(), [], 'exited sessions must not receive drops');
    await page.locator('[role=tab][aria-selected=true]').locator('..').getByRole('button', { name: 'Close tab' }).click();
  } finally {
    await application.evaluate(({ ipcMain }) => {
      const state = (globalThis as unknown as { dropSmoke: DropState }).dropSmoke;
      ipcMain.removeListener('terminal:write', state.listener);
    });
    await page.locator('#drop-fixtures').evaluate(input => input.remove());
  }
}
