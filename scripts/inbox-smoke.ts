import assert from 'node:assert/strict';
import type { ElectronApplication, Page } from 'playwright';

/** Real OSC 7501 output → Inbox queue, header, bar, and keyboard routing. */
export async function verifyInbox(application: ElectronApplication, page: Page): Promise<void> {
  await application.evaluate(({ ipcMain }) => {
    const state = { active: '', listener: (_event: unknown, _ids: string[], active: string) => { state.active = active; } };
    (globalThis as any).inboxSmoke = state;
    ipcMain.on('session:layout', state.listener);
  });
  await page.evaluate(() => {
    const state = window as unknown as { inboxOutput: Record<string, string>; stopInboxOutput: () => void };
    state.inboxOutput = {};
    state.stopInboxOutput = window.terminal.onEvent(event => {
      if (event.type === 'data') state.inboxOutput[event.id] = (state.inboxOutput[event.id] ?? '') + event.data;
    });
  });
  const send = (command: string) => application.evaluate(({ BrowserWindow }, value) =>
    BrowserWindow.getAllWindows()[0].webContents.send('terminal:action', value), command);
  const activeId = () => application.evaluate(() => (globalThis as any).inboxSmoke.active as string);
  const emit = (id: string, body: string) => page.evaluate(({ id, body }) =>
    window.terminal.write(id, `printf '\\033]7501;${body}\\033\\\\'\r`), { id, body });
  const status = (tab: ReturnType<Page['locator']>, expected: string | null) => tab.evaluate((node, expected) => new Promise<void>((resolve, reject) => {
    const matches = () => node.getAttribute('data-agent-status') === expected;
    if (matches()) return resolve();
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error(`Expected status ${expected}, got ${node.getAttribute('data-agent-status')}`)); }, 5000);
    const observer = new MutationObserver(() => { if (matches()) { clearTimeout(timer); observer.disconnect(); resolve(); } });
    observer.observe(node, { attributes: true });
  }), expected);
  const tabIds = () => page.locator('[role=tab]').evaluateAll(tabs => tabs.map(tab => tab.id));
  const openTab = async () => {
    const count = (await tabIds()).length;
    await page.getByRole('button', { name: 'New tab', exact: true }).click();
    await page.waitForFunction(value => document.querySelectorAll('[role=tabpanel][data-ready=true]').length === value, count + 1);
    const tabId = (await page.locator('[role=tab][aria-selected=true]').getAttribute('id'))!;
    return { tabId, sessionId: await activeId(), row: page.locator(`.tab:has(#${tabId})`) };
  };
  const inbox = page.locator('#inbox');
  const title = () => page.locator('#active-title').textContent();

  try {
    const a = await openTab();
    const b = await openTab();
    const order = await tabIds();

    // 1. Empty Inbox.
    assert.equal(await page.locator('#inbox-count').isHidden(), true);
    await inbox.click();
    await page.locator('#inbox-empty').waitFor();
    assert.equal(await page.locator('#inbox-empty h2').textContent(), 'No agents waiting');
    assert.equal(await inbox.getAttribute('aria-current'), 'true');
    assert.equal(await page.locator('[role=tabpanel]:not([hidden])').count(), 0);

    // 2. Arrivals: the first blocked agent appears at once; the queue is oldest first.
    await emit(a.sessionId, 'state=blocked'); await status(a.row, 'blocked');
    await page.waitForFunction(id => document.querySelector('[role=tabpanel]:not([hidden])')?.getAttribute('aria-labelledby') === id, a.tabId);
    await emit(b.sessionId, 'state=blocked'); await status(b.row, 'blocked');
    await page.waitForFunction(() => document.querySelector('#inbox-count')?.textContent === '2');
    assert.ok((await title())!.startsWith('Inbox · 1 of 2 · '), await title() ?? '');
    assert.equal(await a.row.getAttribute('data-in-inbox'), 'true');
    assert.equal(await page.locator('[role=tab][aria-selected=true]').count(), 0);
    assert.equal(await page.locator('#inbox-nav').isVisible(), true);

    // 3. Tabs stay where they are.
    assert.deepEqual(await tabIds(), order);

    // 4. Resolving keeps the agent on screen, and typing still reaches it.
    await emit(a.sessionId, 'state=working'); await status(a.row, 'working');
    await page.waitForFunction(() => document.querySelector('#inbox-bar')?.textContent === 'Back to work · Next ⌘J · 1 waiting');
    assert.equal(await page.locator('[role=tabpanel]:not([hidden])').getAttribute('aria-labelledby'), a.tabId);
    await page.locator('[role=tabpanel]:not([hidden]) .xterm-helper-textarea').focus();
    await page.keyboard.type("printf 'YTERM_%s\\n' 'INBOX_A'");
    await page.keyboard.press('Enter');
    await page.waitForFunction(id => ((window as any).inboxOutput[id] ?? '').includes('YTERM_INBOX_A'), a.sessionId);

    // 5. ⌘W does nothing in the Inbox.
    await send('close-tab');
    assert.deepEqual(await tabIds(), order);

    // 6. ⌘J moves to the next waiting agent.
    await send('inbox');
    await page.waitForFunction(id => document.querySelector('[role=tabpanel]:not([hidden])')?.getAttribute('aria-labelledby') === id, b.tabId);
    assert.ok((await title())!.startsWith('Inbox · 1 of 1 · '), await title() ?? '');
    assert.equal(await page.locator('#inbox-bar').isHidden(), true);

    // 7. Blocked again while shown: back in the queue, no bar.
    await emit(b.sessionId, 'state=working'); await status(b.row, 'working');
    await page.locator('#inbox-bar').waitFor();
    assert.equal(await page.locator('#inbox-bar').textContent(), 'Back to work · No other agents waiting');
    await emit(b.sessionId, 'state=blocked'); await status(b.row, 'blocked');
    await page.locator('#inbox-bar').waitFor({ state: 'hidden' });
    assert.ok((await title())!.startsWith('Inbox · 1 of 1 · '), await title() ?? '');

    // 8. Closing the shown tab from the sidebar falls back to the queue, here empty.
    await b.row.hover(); await b.row.getByRole('button', { name: 'Close tab' }).click();
    await page.locator('#inbox-empty').waitFor();
    assert.equal(await page.locator('#active-directory').textContent(), '');
    assert.equal(await page.locator('#inbox-count').isHidden(), true);

    // 9. A notification for a blocked tab opens the Inbox on it.
    await a.row.locator('[role=tab]').click();
    await emit(a.sessionId, 'state=blocked'); await status(a.row, 'blocked');
    await application.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0].webContents.send('attention:activate', id), a.tabId);
    await page.waitForFunction(() => document.querySelector('#inbox')?.getAttribute('aria-current') === 'true');
    assert.equal(await a.row.getAttribute('data-in-inbox'), 'true');

    // 10. Go to tab leaves the Inbox.
    await page.locator('#inbox-go').click();
    assert.equal(await a.row.locator('[role=tab]').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#inbox-nav').isHidden(), true);
    assert.equal(await page.locator('#inbox-bar').isHidden(), true);
    assert.equal(await page.locator('.tab[data-in-inbox]').count(), 0);
    assert.equal(await inbox.getAttribute('aria-current'), null);

    // ⌘J from a normal tab opens the Inbox; with the queue empty, it shows the empty state.
    await emit(a.sessionId, 'state=idle'); await status(a.row, 'idle');
    await send('inbox');
    await page.locator('#inbox-empty').waitFor();

    // With the sidebar hidden, the empty Inbox must not leave focus in a hidden terminal.
    await a.row.locator('[role=tab]').click();
    await send('toggle-sidebar');
    await page.locator('#sidebar').waitFor({ state: 'hidden' });
    await page.locator('[role=tabpanel]:not([hidden]) .xterm-helper-textarea').focus();
    await send('inbox');
    await page.locator('#inbox-empty').waitFor();
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[hidden]') || document.activeElement === document.body), false,
      'keystrokes must not reach a hidden terminal');
    await send('toggle-sidebar');
    await page.locator('#sidebar').waitFor();

    // Closing the first tab while the Inbox is open keeps the tablist reachable by keyboard.
    await a.row.locator('[role=tab]').click();
    await emit(a.sessionId, 'state=blocked'); await status(a.row, 'blocked');
    await send('inbox');
    await page.waitForFunction(id => document.querySelector('[role=tabpanel]:not([hidden])')?.getAttribute('aria-labelledby') === id, a.tabId);
    const first = page.locator('.tab').first();
    assert.notEqual(await first.locator('[role=tab]').getAttribute('id'), a.tabId);
    await first.hover(); await first.getByRole('button', { name: 'Close tab' }).click();
    assert.equal(await page.locator('[role=tab][tabindex="0"]').count(), 1);
    await emit(a.sessionId, 'state=idle'); await status(a.row, 'idle');
    await a.row.locator('[role=tab]').click();
    await a.row.hover(); await a.row.getByRole('button', { name: 'Close tab' }).click();
  } finally {
    await page.evaluate(() => (window as any).stopInboxOutput());
    await application.evaluate(({ ipcMain }) => {
      ipcMain.removeListener('session:layout', (globalThis as any).inboxSmoke.listener);
      delete (globalThis as any).inboxSmoke;
    });
  }
}
