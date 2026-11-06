import type { ElectronApplication } from 'playwright';

/** Close every tab, then the test-owned windows, so the multi-tab quit dialog never waits for a click. */
export async function closeSmokeApplication(application: ElectronApplication): Promise<void> {
  for (const page of application.windows()) {
    await page.evaluate(async () => {
      for (const button of document.querySelectorAll<HTMLButtonElement>('.tab-close')) button.click();
      // Let the close requests go out, then wait for main to answer a later request.
      await new Promise(resolve => setTimeout(resolve, 0));
      await window.terminal.getPreferences();
    }).catch(() => {}); // A window that is already closing has no tabs to close.
  }
  if (application.windows().length) {
    await application.evaluate(({ BrowserWindow }) => {
      // Destroying a window runs the app's webContents-destroyed session cleanup.
      // These windows and their PTYs belong to the isolated smoke-test profile.
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
    });
  }
  await application.close();
}
