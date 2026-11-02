import type { ElectronApplication } from 'playwright';

/** Close test-owned windows first so normal multi-tab quit protection cannot block teardown. */
export async function closeSmokeApplication(application: ElectronApplication): Promise<void> {
  if (application.windows().length) {
    await application.evaluate(({ BrowserWindow }) => {
      // Destroying a window runs the app's webContents-destroyed session cleanup.
      // These windows and their PTYs belong to the isolated smoke-test profile.
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
    });
  }
  await application.close();
}
