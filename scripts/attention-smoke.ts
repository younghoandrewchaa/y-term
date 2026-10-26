import assert from 'node:assert/strict';
import type { ElectronApplication, Page } from 'playwright';

export async function verifyAttention(application: ElectronApplication, page: Page): Promise<void> {
  const badge = () => application.evaluate(({ app }) => app.dock?.getBadge());
  const waitBadge = async (expected: string) => {
    const deadline = Date.now() + 5000;
    while (await badge() !== expected && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(await badge(), expected);
  };
  const command = async (value: string) => {
    await page.locator('[role=tabpanel]:not([hidden]) .xterm-helper-textarea').focus();
    await page.keyboard.type(value);
    await page.keyboard.press('Enter');
  };
  const first = page.locator('.tab').first();
  // ConEmu progress (OSC 9;4) is not a notification; the iTerm2 message that follows is.
  await command("sleep 2; printf '\\033]9;4;1;50\\007\\033]9;Waiting for approval\\007'");
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[role=tabpanel]:not([hidden])')?.getAttribute('data-ready') === 'true');
  const second = page.locator('.tab').nth(1);
  await page.waitForFunction(() => document.querySelector('.tab')?.hasAttribute('data-attention'));
  assert.equal(await first.locator('[role=tab]').getAttribute('aria-description'), 'Needs attention');
  assert.equal(await first.locator('.tab-attention').isVisible(), true);
  assert.equal(await second.getAttribute('data-attention'), null);
  await waitBadge('1');

  await command("sleep 2; printf '\\007'");
  await first.locator('[role=tab]').click();
  assert.equal(await first.getAttribute('data-attention'), null);
  assert.equal(await first.locator('[role=tab]').getAttribute('aria-description'), null);
  await waitBadge('');
  await page.waitForFunction(() => document.querySelectorAll('.tab')[1]?.hasAttribute('data-attention'));
  await waitBadge('1');

  await second.locator('[role=tab]').click();
  assert.equal(await second.getAttribute('data-attention'), null);
  await waitBadge('');
  await command("sleep 1; printf '\\033]777;notify;Codex;Approve command\\007'");
  await first.locator('[role=tab]').click();
  await page.waitForFunction(() => document.querySelectorAll('.tab')[1]?.hasAttribute('data-attention'));
  await waitBadge('1');
  // Closing a waiting tab must not leave a stale Dock badge.
  await second.hover();
  await second.getByRole('button', { name: 'Close tab' }).click();
  await waitBadge('');
}
