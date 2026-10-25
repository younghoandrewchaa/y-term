import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const tabCount of [2, 1, 0]) {
  const directory = await mkdtemp(join(tmpdir(), 'y-term-quit-'));
  const application = await electron.launch({ args: ['.'], env: { ...process.env, Y_TERM_TEST_DATA: directory } });
  try {
    const page = await application.firstWindow();
    await page.waitForFunction(() => document.querySelector('[role=tabpanel]')?.getAttribute('data-ready') === 'true');
    if (tabCount === 2) {
      await page.getByRole('button', { name: 'New tab', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('[role=tabpanel][data-ready=true]').length === 2);
    } else if (tabCount === 0) {
      await page.getByRole('button', { name: 'Close tab' }).click();
      // Flush the preceding close IPC before requesting quit.
      await page.evaluate(() => window.terminal.getPreferences());
    }
    await application.evaluate(({ dialog }) => {
      // Replace only the native dialog; exercise the real quit and session cleanup.
      dialog.showMessageBoxSync = options => {
        if (!('message' in options)) throw new Error('Expected dialog options');
        assertDialog(options);
        return 0;
      };
      function assertDialog(options: Electron.MessageBoxSyncOptions) {
        if (options.cancelId !== 0 || options.defaultId !== 0) throw new Error('Cancel must be the safe default');
      }
    });
    if (tabCount === 2) {
      const survived = await application.evaluate(({ app }) => {
        app.quit();
        return true;
      }).catch(() => false);
      assert.equal(survived, true, 'Cancel must keep the app open with multiple tabs');
      assert.equal(await page.getByRole('tab').count(), 2);
      await page.evaluate(() => {
        window.terminal.onEvent(event => {
          if (event.type === 'data' && event.data.includes('QUIT_CANCEL_ALIVE')) document.body.dataset.quitAlive = 'true';
        });
      });
      await page.locator('.terminal-panel:not([hidden]) .xterm-helper-textarea').fill("printf 'QUIT_CANCEL_%s\\n' ALIVE");
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.body.dataset.quitAlive === 'true');
    }
    await application.evaluate(({ dialog }, tabCount) => {
      dialog.showMessageBoxSync = () => {
        if (tabCount !== 2) throw new Error('Zero or one tab must quit without a dialog');
        return 1;
      };
    }, tabCount);
    const closed = application.waitForEvent('close');
    await application.evaluate(({ app }) => app.quit()).catch(() => {});
    await closed;
  } finally {
    if (application.windows().length) await application.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
console.log('PASS: quit confirmation, Cancel preserves sessions, confirmed Quit, and zero/one-tab quit.');
