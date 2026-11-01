import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';

/** Real PTY output → xterm OSC parser → sidebar and attention state. */
export async function verifyAgentStatus(application: ElectronApplication, page: Page): Promise<void> {
  await application.evaluate(({ ipcMain }) => {
    const state = { active: '', notifications: 0, listener: (_event: unknown, _ids: string[], active: string) => { state.active = active; },
      notified: () => { state.notifications++; } };
    (globalThis as any).agentStatusSmoke = state;
    ipcMain.on('session:layout', state.listener);
    ipcMain.on('attention:notify', state.notified);
  });
  const ready = () => page.waitForFunction(() => document.querySelector('[role=tabpanel]:not([hidden])')?.getAttribute('data-ready') === 'true');
  const activeId = () => application.evaluate(() => (globalThis as any).agentStatusSmoke.active as string);
  const command = async (id: string, text: string) => { await page.evaluate(({ id, text }) => window.terminal.write(id, `${text}\r`), { id, text }); };
  const emit = (id: string, body: string) => command(id, `printf '\\033]7501;${body}\\033\\\\'`);
  const badge = async (expected: string) => {
    const deadline = Date.now() + 5000;
    while (await application.evaluate(({ app }) => app.dock?.getBadge()) !== expected && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(await application.evaluate(({ app }) => app.dock?.getBadge()), expected);
  };
  const state = async (tab: ReturnType<Page['locator']>, expected: string | null) => {
    await tab.evaluate((node, expected) => new Promise<void>((resolve, reject) => {
      const matches = () => node.getAttribute('data-agent-status') === expected;
      if (matches()) return resolve();
      const timer = setTimeout(() => { observer.disconnect(); reject(new Error(`Expected status ${expected}, got ${node.getAttribute('data-agent-status')}`)); }, 5000);
      const observer = new MutationObserver(() => { if (matches()) { clearTimeout(timer); observer.disconnect(); resolve(); } });
      observer.observe(node, { attributes: true });
    }), expected);
  };
  try {
    await page.getByRole('button', { name: 'New tab', exact: true }).click(); await ready();
    const id = await activeId(); assert.ok(id);
    const tab = page.locator('.tab:has([aria-selected=true])');
    const tabId = await tab.locator('[role=tab]').getAttribute('id');
    const agent = page.locator(`.tab:has(#${tabId})`);
    assert.equal(await agent.getAttribute('data-agent-status'), null);
    // Probe from a real raw-mode program so the response cannot become shell input.
    await page.evaluate(() => {
      (window as any).agentStatusQueryOutput = '';
      (window as any).stopAgentStatusQuery = window.terminal.onEvent(event => {
        if (event.type === 'data') (window as any).agentStatusQueryOutput += event.data;
      });
    });
    const probe = `import os, select, termios, tty
old = termios.tcgetattr(0)
data = b''
try:
    tty.setraw(0)
    os.write(1, b'\\x1b]7501;?\\x1b\\\\')
    while not data.endswith(b'\\x1b\\\\'):
        if not select.select([0], [], [], 3)[0]: break
        data += os.read(0, 4096)
finally:
    termios.tcsetattr(0, termios.TCSANOW, old)
assert data == b'\\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\\x1b\\\\', repr(data)
print('YTERM_7501_QUERY_OK')`;
    await command(id, `/usr/bin/python3 -c 'import base64; exec(base64.b64decode("${Buffer.from(probe).toString('base64')}"))'`);
    await page.waitForFunction(() => (window as any).agentStatusQueryOutput.includes('YTERM_7501_QUERY_OK'));
    await page.evaluate(() => (window as any).stopAgentStatusQuery());
    await emit(id, 'state=working:app=codex'); await state(agent, 'working');
    assert.equal(await agent.locator('.tab-agent-status').textContent(), 'Working');

    await page.getByRole('button', { name: 'New tab', exact: true }).click(); await ready();
    const otherId = await activeId(); assert.notEqual(otherId, id);
    const otherTabId = await page.locator('.tab:has([aria-selected=true]) [role=tab]').getAttribute('id');
    const other = page.locator(`.tab:has(#${otherTabId})`);
    await emit(id, 'state=idle'); await state(agent, 'done'); await badge('1');
    const notices = await application.evaluate(() => (globalThis as any).agentStatusSmoke.notifications as number);
    await emit(id, 'state=done'); await emit(id, 'state=idle');
    await emit(otherId, 'state=idle'); await state(other, 'idle');
    assert.equal(await agent.getAttribute('data-agent-status'), 'done');
    assert.equal(await application.evaluate(() => (globalThis as any).agentStatusSmoke.notifications), notices);
    await agent.locator('[role=tab]').click(); await state(agent, 'idle'); await badge('');
    await emit(id, 'state=done'); await emit(id, 'state=blocked'); await state(agent, 'blocked'); await badge('1');
    await command(id, ':');
    assert.equal(await agent.getAttribute('data-agent-status'), 'blocked');
    await other.locator('[role=tab]').click(); await agent.locator('[role=tab]').click();
    assert.equal(await agent.getAttribute('data-agent-status'), 'blocked');
    await emit(id, 'state=working'); await state(agent, 'working'); await badge('');
    await emit(id, 'state=done'); await state(agent, 'idle');

    // Child state/clear must never overwrite the root record.
    await emit(id, 'state=working'); await state(agent, 'working');
    await emit(id, 'state=blocked:id=worker'); await emit(id, 'state=clear:id=worker');
    await emit(otherId, 'state=working'); await state(other, 'working');
    assert.equal(await agent.getAttribute('data-agent-status'), 'working');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await emit(id, 'state=idle'); await state(agent, 'done');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await state(agent, 'idle');

    await emit(id, 'state=working'); await state(agent, 'working');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    await emit(id, 'state=done'); await state(agent, 'done');
    await application.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); });
    await state(agent, 'idle');

    // A report split across PTY writes and BEL termination still routes once.
    await command(id, "printf '\\033]7501;state=wor'; sleep 0.1; printf 'king\\007'"); await state(agent, 'working');
    await emit(id, 'state=error'); await state(agent, 'blocked');
    if (process.env.Y_TERM_SCREENSHOTS) {
      await mkdir(process.env.Y_TERM_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: join(process.env.Y_TERM_SCREENSHOTS, 'agent-status-dark.png') });
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.locator('select[name=theme]').selectOption('light');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.screenshot({ path: join(process.env.Y_TERM_SCREENSHOTS, 'agent-status-light.png') });
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.locator('select[name=theme]').selectOption('dark');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
    }
    await emit(otherId, 'state=blocked'); await state(other, 'blocked'); await badge('2');
    await command(otherId, "printf '\\033]777;notify;Reporter;Needs attention\\007'");
    await emit(id, 'state=clear'); await state(agent, null); await badge('1');
    assert.equal(await agent.locator('.tab-agent-status').isVisible(), false);
    await emit(otherId, 'state=done'); await state(other, 'done'); await badge('1');
    await application.evaluate(({ BrowserWindow }, tabId) => {
      BrowserWindow.getAllWindows()[0].webContents.send('attention:activate', tabId);
    }, otherTabId);
    await state(other, 'idle'); await badge('');
    assert.equal(await other.locator('[role=tab]').getAttribute('aria-selected'), 'true');
    await emit(otherId, 'state=blocked'); await state(other, 'blocked'); await badge('1');
    await other.hover(); await other.getByRole('button', { name: 'Close tab' }).click(); await badge('');
    await emit(id, 'state=working'); await state(agent, 'working');
    // Initial process detection preserves a report; removal clears an established agent.
    await application.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.getAllWindows()[0].webContents.send('terminal:event', { type: 'agent', id, agent: 'Codex' });
    }, id);
    assert.equal(await agent.getAttribute('data-agent-status'), 'working');
    await application.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.getAllWindows()[0].webContents.send('terminal:event', { type: 'agent', id });
    }, id);
    await state(agent, null);
    await emit(id, 'state=working'); await state(agent, 'working');
    await command(id, "printf '\\033c'"); await state(agent, null);
    await emit(id, 'state=working'); await state(agent, 'working');
    await command(id, 'exit'); await state(agent, null);
    await agent.hover(); await agent.getByRole('button', { name: 'Close tab' }).click();
  } finally {
    await application.evaluate(({ ipcMain, BrowserWindow }) => {
      const state = (globalThis as any).agentStatusSmoke;
      ipcMain.removeListener('session:layout', state.listener);
      ipcMain.removeListener('attention:notify', state.notified);
      BrowserWindow.getAllWindows()[0]?.show();
    });
  }
}
