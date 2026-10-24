import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyFileDrops } from './file-drop-smoke.ts';
import { verifyVisualDesign } from './visual-smoke.ts';

const directory = await mkdtemp(join(tmpdir(), 'y-term-smoke-'));
const executablePath = process.env.Y_TERM_EXECUTABLE;
const application = await electron.launch({
  ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }),
  env: { ...process.env, Y_TERM_TEST_DATA: directory },
});
try {
  const page = await application.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('[role=tab]').waitFor();
  await page.waitForFunction(() => document.querySelector('[role=tabpanel]')?.getAttribute('data-ready') === 'true');
  await page.evaluate(() => {
    const state = window as unknown as { smokeOutput: string };
    state.smokeOutput = '';
    window.terminal.onEvent(event => { if (event.type === 'data') state.smokeOutput += event.data; });
  });
  await page.locator('.xterm-helper-textarea').first().focus();
  await page.keyboard.type("printf 'YTERM_%s\\n' 'SHELL_OK'");
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as unknown as { smokeOutput: string }).smokeOutput.includes('YTERM_SHELL_OK'));
  await page.waitForFunction(() => document.querySelector('[role=tabpanel]:not([hidden]) .xterm-rows')?.textContent?.includes('YTERM_SHELL_OK'));
  // Observe real keyboard input at the main-process boundary, including any
  // accidental duplicate carriage return from xterm's default key handling.
  await application.evaluate(({ ipcMain }) => {
    const state = { writes: [] as string[], listener: (_event: unknown, _id: string, data: string) => { state.writes.push(data); } };
    (globalThis as unknown as { keyboardSmoke: typeof state }).keyboardSmoke = state;
    ipcMain.on('terminal:write', state.listener);
  });
  try {
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.press('Enter');
    await page.evaluate(() => window.terminal.getPreferences());
    const writes = await application.evaluate(() => (globalThis as unknown as { keyboardSmoke: { writes: string[] } }).keyboardSmoke.writes);
    assert.deepEqual(writes, ['\x1b[13;2u', '\r'], 'Shift+Enter must send modified Enter once; Enter must still submit');
    await application.evaluate(() => { (globalThis as unknown as { keyboardSmoke: { writes: string[] } }).keyboardSmoke.writes = []; });
    await page.keyboard.press('Meta+Backspace');
    await page.evaluate(() => window.terminal.getPreferences());
    const deleteWrites = await application.evaluate(() => (globalThis as unknown as { keyboardSmoke: { writes: string[] } }).keyboardSmoke.writes);
    assert.deepEqual(deleteWrites, ['\x15'], 'Cmd+Backspace must send backward line deletion exactly once');
  } finally {
    await application.evaluate(({ ipcMain }) => {
      const state = (globalThis as unknown as { keyboardSmoke: { listener: (...args: unknown[]) => void } }).keyboardSmoke;
      ipcMain.removeListener('terminal:write', state.listener);
    });
  }
  await page.keyboard.press('Control+u');
  await page.keyboard.type("discard printf 'YTERM_%s\\n' 'DELETE_OK'");
  await page.keyboard.press('Control+a');
  for (let index = 0; index < 'discard '.length; index++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Meta+Backspace');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as unknown as { smokeOutput: string }).smokeOutput.includes('YTERM_DELETE_OK'));
  await page.keyboard.type("printf 'YTERM_BEFORE:'; stty size");
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /YTERM_BEFORE:\d+\s+\d+/.test((window as unknown as { smokeOutput: string }).smokeOutput));
  const previousScreen = await page.locator('[role=tabpanel]:not([hidden]) .xterm-screen').boundingBox();
  assert.ok(previousScreen);
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(900, 600); });
  await page.waitForFunction(previous => {
    const current = document.querySelector('[role=tabpanel]:not([hidden]) .xterm-screen')?.getBoundingClientRect();
    return current && (current.width !== previous.width || current.height !== previous.height);
  }, previousScreen);
  await page.keyboard.type("printf 'YTERM_AFTER:'; stty size");
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /YTERM_AFTER:\d+\s+\d+/.test((window as unknown as { smokeOutput: string }).smokeOutput));
  const sizes = await page.evaluate(() => {
    const text = (window as unknown as { smokeOutput: string }).smokeOutput;
    return [text.match(/YTERM_BEFORE:(\d+)\s+(\d+)/)?.slice(1), text.match(/YTERM_AFTER:(\d+)\s+(\d+)/)?.slice(1)];
  });
  assert.notDeepEqual(sizes[0], sizes[1], 'resizing must reach the actual PTY');
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[role=tab]').length === 2 && document.querySelector('[role=tabpanel]:not([hidden])')?.getAttribute('data-ready') === 'true');
  await page.locator('[role=tabpanel]:not([hidden]) .xterm-helper-textarea').focus();
  await page.keyboard.type("cd /private/tmp; printf 'YTERM_%s:%s\\n' 'TAB_TWO' \"$PWD\"");
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as unknown as { smokeOutput: string }).smokeOutput.includes('YTERM_TAB_TWO:/private/tmp'));
  await verifyFileDrops(application, page, directory);
  await page.locator('[role=tab]').first().click();
  await page.locator('[role=tabpanel]:not([hidden]) .xterm-helper-textarea').focus();
  await page.keyboard.type("printf 'YTERM_%s\\n' 'FIRST_ALIVE'");
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as unknown as { smokeOutput: string }).smokeOutput.includes('YTERM_FIRST_ALIVE'));
  // A foreground program that ignores hangup must also end on tab closure.
  await page.keyboard.type("/bin/sh -c 'trap \"\" HUP; printf \"YTERM_PID:%s\\n\" \"$$\"; exec sleep 120'");
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /YTERM_PID:\d+/.test((window as unknown as { smokeOutput: string }).smokeOutput));
  const childPid = await page.evaluate(() => Number((window as unknown as { smokeOutput: string }).smokeOutput.match(/YTERM_PID:(\d+)/)?.[1]));
  assert.ok(childPid > 1);
  await page.getByRole('button', { name: 'Close tab' }).first().click();
  const processEnded = async () => application.evaluate((_electron, pid) => {
    try { process.kill(pid, 0); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
  }, childPid);
  const deadline = Date.now() + 5000;
  while (!(await processEnded()) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await processEnded(), true, 'closing the tab must terminate its foreground process');
  assert.equal(await page.locator('[role=tab]').count(), 1);
  const rejected = await page.evaluate(async () => {
    try { await window.terminal.openLink('file:///etc/passwd'); return false; } catch { return true; }
  });
  assert.equal(rejected, true);
  await verifyVisualDesign(application, page);
  assert.deepEqual(errors, []);
  console.log('PASS: shell commands, keyboard input, file/folder drops, resize, independent tabs, closure, URL policy, sidebar layout, themes, search, and empty state.');
} finally {
  await application.close();
  await rm(directory, { recursive: true, force: true });
}
