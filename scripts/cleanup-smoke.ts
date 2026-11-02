import { _electron as electron } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeSmokeApplication } from './smoke-cleanup.ts';

const directory = await mkdtemp(join(tmpdir(), 'y-term-cleanup-'));
const application = await electron.launch({ args: ['.'], env: { ...process.env, Y_TERM_TEST_DATA: directory } });
try {
  const page = await application.firstWindow();
  await page.waitForFunction(() => document.querySelector('[role=tabpanel]')?.getAttribute('data-ready') === 'true');
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[role=tabpanel][data-ready=true]').length === 2);
  await application.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => { throw new Error('Test cleanup must not open the multi-tab quit dialog'); };
  });
  const closed = application.waitForEvent('close', { timeout: 10000 });
  await closeSmokeApplication(application);
  await closed;
  console.log('PASS: multi-tab smoke teardown closes without a native quit dialog.');
} finally {
  if (application.windows().length) await closeSmokeApplication(application);
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
