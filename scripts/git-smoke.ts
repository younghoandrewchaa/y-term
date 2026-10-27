import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';
import type { Page } from 'playwright';

const directory = await realpath(await mkdtemp(join(tmpdir(), 'y-term-git-ui-')));
const repository = join(directory, 'project');
const other = join(directory, 'other-project');
const data = join(directory, 'app-data');
const screenshots = process.env.Y_TERM_SCREENSHOTS ?? '/private/tmp/y-term-git-screenshots';
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
await Promise.all([repository, other, data, screenshots].map(path => mkdir(path, { recursive: true })));
for (const root of [repository, other]) {
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 'test@example.invalid'); git(root, 'config', 'user.name', 'Test');
}
await mkdir(join(repository, 'src/renderer'), { recursive: true });
await mkdir(join(repository, 'scripts'));
await writeFile(join(repository, 'src/renderer/app.ts'), 'const enabled = false;\nconst interval = 0;\n');
await writeFile(join(repository, 'scripts/update-smoke.ts'), 'const expected = false;\n');
git(repository, 'add', '.'); git(repository, 'commit', '-qm', 'base');
await writeFile(join(repository, 'src/renderer/app.ts'), 'const enabled = true;\nconst interval = 0;\n');
git(repository, 'add', 'src/renderer/app.ts');
await writeFile(join(repository, 'src/renderer/app.ts'), 'const enabled = true;\nconst interval = 5000;\n');
await writeFile(join(repository, 'scripts/update-smoke.ts'), 'const expected = true;\n');
await writeFile(join(repository, 'new.ts'), '<img src=x onerror="window.gitUnsafe=true">\n');
await writeFile(join(repository, 'binary.dat'), Buffer.from([0, 1, 2]));
await writeFile(join(repository, 'large.txt'), 'x'.repeat(2 * 1024 * 1024 + 1));
await writeFile(join(other, 'other.ts'), 'other repository\n');
await writeFile(join(data, 'preferences.json'), JSON.stringify({ cwd: repository, shell: '/bin/bash', theme: 'dark' }));
const application = await electron.launch({ args: ['.'], env: { ...process.env, Y_TERM_TEST_DATA: data } });
try {
  const page = await application.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const ready = (target = page) => target.waitForFunction(() => document.querySelector('[role=tabpanel]:not([hidden])')?.getAttribute('data-ready') === 'true');
  await ready();
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].focus(); });
  await page.evaluate(() => {
    (window as unknown as { gitOutput: string }).gitOutput = '';
    window.terminal.onEvent(event => { if (event.type === 'data') (window as unknown as { gitOutput: string }).gitOutput += event.data; });
  });
  const sessionId = async (target: Page) => {
    await application.evaluate(({ ipcMain }) => {
      (globalThis as unknown as { gitSession?: string }).gitSession = undefined;
      ipcMain.once('terminal:write', (_event, id: string) => { (globalThis as unknown as { gitSession?: string }).gitSession = id; });
    });
    await target.locator('[role=tabpanel]:not([hidden]) .xterm-helper-textarea').focus();
    await target.keyboard.press('Control+u');
    await target.evaluate(() => window.terminal.getPreferences());
    const id = await application.evaluate(() => (globalThis as unknown as { gitSession?: string }).gitSession);
    assert.ok(id); return id;
  };
  const id = await sessionId(page);
  const command = async (value: string) => page.evaluate(({ id, value }) => window.terminal.write(id, `${value}\r`), { id, value });
  const waitDiff = (text: string) => page.waitForFunction(value => document.getElementById('git-diff-table')?.textContent?.includes(value), text);
  const select = async (path: string) => {
    await page.locator('.git-file').filter({ has: page.locator('.git-file-path', { hasText: path }) }).click();
    await page.waitForFunction(value => document.getElementById('git-file-title')?.textContent === value && document.getElementById('git-panel')?.getAttribute('aria-busy') === 'false', path);
  };
  const resize = async (width: number) => {
    await application.evaluate(({ BrowserWindow }, width) => { BrowserWindow.getAllWindows()[0].setSize(width, 760); }, width);
    await page.waitForFunction(width => innerWidth === width, width);
  };
  await page.locator('#changes-toggle').click();
  await page.waitForFunction(() => document.querySelectorAll('.git-file').length === 5);
  await select('src/renderer/app.ts'); await waitDiff('const interval = 5000;');

  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.send('terminal:action', 'find'); });
  assert.equal(await page.locator('#panels').isVisible(), true, 'terminal Find must reveal the terminal');
  await page.locator('#find-input').press('Escape');
  await page.locator('#changes-toggle').click();
  await waitDiff('const interval = 5000;');
  assert.equal(await page.locator('.git-column-heading').allTextContents().then(labels => labels.join('/')), 'Index/Working tree');
  assert.ok((await page.locator('.git-line-number').allTextContents()).includes('2'));
  assert.ok(await page.locator('.git-removed .git-code').allTextContents().then(lines => lines.includes('const interval = 0;')));
  await page.locator('#git-staged').click(); await waitDiff('const enabled = false;');
  assert.equal((await page.locator('.git-column-heading').allTextContents()).join('/'), 'HEAD/Index');
  assert.equal((await page.locator('#git-diff-table').textContent())!.includes('5000'), false);
  await page.locator('#git-unstaged').click(); await select('scripts/update-smoke.ts'); await waitDiff('const expected = true;');
  await writeFile(join(repository, 'scripts/update-smoke.ts'), 'const expected = "refreshed";\n');
  await page.locator('#git-refresh').click(); await waitDiff('const expected = "refreshed";');
  await select('new.ts'); await waitDiff('<img src=x');
  assert.equal(await page.locator('#git-diff-table img').count(), 0);
  assert.equal(await page.evaluate(() => (window as unknown as { gitUnsafe?: boolean }).gitUnsafe), undefined);
  await select('binary.dat'); await waitDiff('Binary file');
  await select('large.txt'); await waitDiff('too large');
  await select('src/renderer/app.ts'); await waitDiff('const interval = 5000;');

  // Copy source using the native copy command; preserve every clipboard format.
  await application.evaluate(({ clipboard }) => {
    (globalThis as unknown as { gitClipboard: { format: string; buffer: Buffer }[] }).gitClipboard = clipboard.availableFormats().map(format => ({ format, buffer: clipboard.readBuffer(format) }));
  });
  try {
    await page.locator('.git-added .git-code').first().evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    });
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.copy(); });
    const deadline = Date.now() + 3000;
    let copied = '';
    do { copied = await application.evaluate(({ clipboard }) => clipboard.readText()); if (copied.includes('const interval = 5000;')) break; } while (Date.now() < deadline);
    assert.equal(copied, 'const interval = 5000;');
  } finally {
    await application.evaluate(({ clipboard }) => {
      clipboard.clear();
      for (const { format, buffer } of (globalThis as unknown as { gitClipboard: { format: string; buffer: Buffer }[] }).gitClipboard) clipboard.writeBuffer(format, buffer);
    });
  }
  for (const theme of ['dark', 'light'] as const) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('select[name=theme]').selectOption(theme);
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.send('terminal:action', 'toggle-changes'); });
    assert.equal(await page.locator('#git-panel').isVisible(), true, 'modal blocks menu toggle');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    for (const width of [1440, 1000, 640]) {
      await resize(width);
      await page.waitForFunction(width => document.getElementById('panels')?.hidden === (width < 1440), width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth), true);
      await page.screenshot({ path: join(screenshots, `${theme}-${width}.png`) });
      await page.locator('#git-close').focus(); await page.keyboard.press('Escape');
      assert.equal(await page.locator('#git-panel').isVisible(), false);
      await command(`printf 'GIT_%s\\n' '${theme}_${width}_ALIVE'`);
      await page.waitForFunction(marker => (window as unknown as { gitOutput: string }).gitOutput.includes(marker), `GIT_${theme}_${width}_ALIVE`);
      await page.locator('#changes-toggle').click(); await waitDiff('const interval = 5000;');
    }
  }
  await resize(1440);
  const before = await page.locator('#git-panel').boundingBox(); assert.ok(before);
  await page.locator('#git-divider').focus(); await page.keyboard.press('ArrowLeft');
  const after = await page.locator('#git-panel').boundingBox(); assert.ok(after && after.width >= before.width);
  const divider = await page.locator('#git-divider').boundingBox(); assert.ok(divider);
  await page.mouse.move(divider.x + divider.width / 2, divider.y + 100); await page.mouse.down(); await page.mouse.move(divider.x + 30, divider.y + 100); await page.mouse.up();
  await page.locator('#git-expand').click(); assert.equal(await page.locator('#panels').isVisible(), false);
  await page.locator('#git-expand').click(); assert.equal(await page.locator('#panels').isVisible(), true);
  await page.locator('.git-file').first().focus(); await page.keyboard.press('End');
  assert.equal(await page.locator('.git-file').last().getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Home'); assert.equal(await page.locator('.git-file').first().getAttribute('aria-pressed'), 'true');

  // Invoke the actual native menu item (synthetic macOS accelerators are unreliable).
  await application.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()!.items.find(i => i.label === 'View')!.submenu!.items.find(i => i.label === 'Toggle Changes')!;
    assertMenu(item.accelerator === 'CmdOrCtrl+Shift+G');
    (item.click as () => void)();
    function assertMenu(value: boolean) { if (!value) throw new Error('Missing changes accelerator'); }
  });
  await page.locator('#git-panel').waitFor({ state: 'hidden' });
  await page.locator('#changes-toggle').click();

  const rejected = await page.evaluate(async id => {
    const attempts = [() => window.terminal.getGitStatus('unknown-session'), () => window.terminal.getGitDiff(id, 'invalid' as 'staged', 'new.ts')];
    return Promise.all(attempts.map(async attempt => { try { await attempt(); return false; } catch { return true; } }));
  }, id);
  assert.deepEqual(rejected, [true, true]);
  await command(`cd '${other}'`);
  await page.waitForFunction(() => document.getElementById('git-repository')?.textContent === 'other-project');
  await page.waitForFunction(() => document.querySelector('.git-file-path')?.textContent === 'other.ts');
  assert.equal((await page.locator('#git-diff-table').textContent())!.includes('5000'), false);
  await page.locator('#git-close').click();
  await page.getByRole('button', { name: 'New tab', exact: true }).click(); await ready();
  await page.locator('#changes-toggle').click();
  await page.waitForFunction(() => document.getElementById('git-repository')?.textContent === 'other-project');
  await page.locator('.tab').first().getByRole('tab').click();
  await command(`cd '${repository}'`);
  await page.waitForFunction(() => document.getElementById('git-repository')?.textContent === 'project');
  await page.locator('.tab:has([aria-selected=true])').hover();
  await page.locator('.tab:has([aria-selected=true]) .tab-close').click();
  await page.waitForFunction(() => document.getElementById('git-repository')?.textContent === 'other-project');
  await page.locator('#git-close').click();

  const newWindow = application.waitForEvent('window');
  await application.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()!.items.find(i => i.label === 'Shell')!.submenu!.items.find(i => i.label === 'New Window')!;
    (item.click as () => void)();
  });
  const second = await newWindow; await ready(second);
  const secondId = await sessionId(second);
  const foreign = await page.evaluate(async id => { try { await window.terminal.getGitStatus(id); return false; } catch { return true; } }, secondId);
  assert.equal(foreign, true);
  await second.close();
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].focus(); });
  const remainingId = await sessionId(page);
  await page.locator('#changes-toggle').click();
  await rm(join(other, 'other.ts'));
  await page.locator('#git-refresh').click();
  await page.waitForFunction(() => document.getElementById('git-message')?.textContent === 'Working tree is clean.');
  assert.equal(await page.locator('.git-code').count(), 0);
  await page.evaluate(({ id, cwd }) => window.terminal.write(id, `cd '${cwd}'\r`), { id: remainingId, cwd: directory });
  await page.waitForFunction(() => document.getElementById('git-message')?.textContent?.includes('outside a Git repository'));
  await page.evaluate(id => window.terminal.write(id, 'exit\r'), remainingId);
  await page.waitForFunction(() => document.getElementById('git-message')?.textContent?.includes('shell has exited'));
  await page.locator('.tab:has([aria-selected=true])').hover();
  await page.locator('.tab:has([aria-selected=true]) .tab-close').click();
  await page.waitForFunction(() => document.getElementById('git-message')?.textContent?.includes('Open a terminal session'));
  assert.deepEqual(errors, []);
  console.log(`PASS: real Git panel, staged/unstaged/untracked, refresh, safe summaries/copy, both themes, three widths, layout, live shells, cd/tab/window ownership. Screenshots: ${screenshots}`);
} finally {
  await application.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
