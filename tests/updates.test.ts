import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { UpdateManager, selectRelease } from '../src/main/updates.ts';

const base = 'https://github.com/younghoandrewchaa/y-term/releases/download/v0.2.0/';
function release(version = '0.2.0') {
  const url = base.replace('0.2.0', version);
  return { tag_name: `v${version}`, draft: false, prerelease: false, assets: [
    { name: `Y-Term-darwin-arm64-${version}.zip`, browser_download_url: `${url}Y-Term-darwin-arm64-${version}.zip` },
    { name: 'update-darwin-arm64.json', browser_download_url: `${url}update-darwin-arm64.json` },
  ] };
}

test('selects only a newer stable release with the correct architecture and trusted assets', () => {
  assert.deepEqual(selectRelease(release(), '0.1.3'), { version: '0.2.0', feedUrl: `${base}update-darwin-arm64.json` });
  assert.equal(selectRelease(release('0.1.3'), '0.1.3'), undefined);
  assert.equal(selectRelease(release('0.1.2'), '0.1.3'), undefined);
  assert.ok(selectRelease(release('0.10.0'), '0.9.0'));
  for (const value of [null, {}, { ...release(), draft: true }, { ...release(), prerelease: true }, release('0.2.0-beta.1'), { ...release(), assets: [] }]) {
    assert.equal(selectRelease(value, '0.1.3'), undefined);
  }
  const foreign = release(); foreign.assets[0].browser_download_url = 'https://example.com/update.zip';
  assert.equal(selectRelease(foreign, '0.1.3'), undefined);
  const wrongArch = release(); wrongArch.assets[0].name = 'Y-Term-darwin-x64-0.2.0.zip';
  assert.equal(selectRelease(wrongArch, '0.1.3'), undefined);
});

class NativeUpdater extends EventEmitter {
  feeds: unknown[] = [];
  downloads = 0;
  installs = 0;
  setFeedURL(options: unknown) { this.feeds.push(options); }
  checkForUpdates() { this.downloads++; }
  quitAndInstall() { this.installs++; }
}
function setup(enabled = true) {
  const native = new NativeUpdater();
  let requests = 0; let confirmations = 0; let accepted = true; let now = 0;
  let fetchRelease = async (): Promise<unknown> => { requests++; return release(); };
  const states: string[] = [];
  const manager = new UpdateManager({ version: '0.1.3', enabled, native,
    fetchRelease: () => fetchRelease(), confirm: async () => { confirmations++; return accepted; },
    publish: state => states.push(state.status), now: () => now,
  });
  return { manager, native, states, get requests() { return requests; }, get confirmations() { return confirmations; },
    setAccepted(value: boolean) { accepted = value; }, setFetch(value: typeof fetchRelease) { fetchRelease = value; },
    advance() { now += 5 * 60_000; },
  };
}

test('checks without downloading, coalesces concurrent checks, and throttles new tabs', async () => {
  const f = setup();
  await Promise.all([f.manager.check(), f.manager.check(), f.manager.check()]);
  assert.equal(f.requests, 1); assert.equal(f.native.downloads, 0);
  assert.deepEqual(f.manager.getState(), { version: '0.1.3', status: 'available', latestVersion: '0.2.0' });
  await f.manager.check(); assert.equal(f.requests, 1);
  f.advance(); await f.manager.check(); assert.equal(f.requests, 2);
});

test('confirmation cancellation preserves availability and does not start a download', async () => {
  const f = setup(); await f.manager.check(); f.setAccepted(false);
  await f.manager.install();
  assert.equal(f.native.downloads, 0); assert.equal(f.manager.getState().status, 'available');
});

test('one confirmed click downloads then installs only after update-downloaded', async () => {
  const f = setup(); await f.manager.check();
  await Promise.all([f.manager.install(), f.manager.install()]);
  assert.equal(f.confirmations, 1); assert.equal(f.native.downloads, 1); assert.equal(f.native.installs, 0);
  assert.deepEqual(f.native.feeds, [{ url: `${base}update-darwin-arm64.json`, serverType: 'json' }]);
  assert.equal(f.manager.isInstalling, false);
  f.native.emit('update-downloaded');
  assert.equal(f.native.installs, 1); assert.equal(f.manager.isInstalling, true);
  assert.equal(f.states.at(-1), 'installing');
  await f.manager.check(); assert.equal(f.requests, 1);
});

test('offline checks can be retried immediately and download errors retain the update', async () => {
  const f = setup(); f.setFetch(async () => { throw new Error('offline'); });
  await f.manager.check(); assert.equal(f.manager.getState().status, 'error');
  f.setFetch(async () => release()); await f.manager.check(true);
  await f.manager.install(); f.native.emit('error', new Error('signature or network failure'));
  assert.equal(f.manager.getState().status, 'error'); assert.equal(f.native.installs, 0);
  assert.equal(f.manager.getState().latestVersion, '0.2.0');
  await f.manager.install(); assert.equal(f.native.downloads, 2);
});

test('disabled builds show the current version without network or updater activity', async () => {
  const f = setup(false); await f.manager.check(true); await f.manager.install();
  assert.equal(f.requests, 0); assert.equal(f.native.downloads, 0);
  assert.deepEqual(f.manager.getState(), { version: '0.1.3', status: 'disabled' });
});

test('native no-update response recovers instead of remaining busy', async () => {
  const f = setup(); await f.manager.check(); await f.manager.install();
  f.native.emit('update-not-available');
  assert.equal(f.manager.getState().status, 'idle'); assert.equal(f.native.installs, 0);
});

test('saves tabs for the new version just before restarting, without letting failures block it', async () => {
  for (const fail of [false, true]) {
    const native = new NativeUpdater();
    const calls: string[] = [];
    native.quitAndInstall = () => { calls.push('install'); };
    const manager = new UpdateManager({ version: '0.1.3', enabled: true, native, fetchRelease: async () => release(),
      confirm: async () => true, publish: () => {},
      beforeRestart: version => { calls.push(`save ${version}`); if (fail) throw new Error('disk full'); },
      restartFailed: () => calls.push('discard') });
    await manager.check(); await manager.install();
    assert.deepEqual(calls, []);
    native.emit('update-downloaded');
    assert.deepEqual(calls, ['save 0.2.0', 'install']);
  }
});

test('discards saved tabs when the restart cannot begin', async () => {
  const native = new NativeUpdater();
  native.quitAndInstall = () => { throw new Error('not signed'); };
  const calls: string[] = [];
  const manager = new UpdateManager({ version: '0.1.3', enabled: true, native, fetchRelease: async () => release(),
    confirm: async () => true, publish: () => {}, beforeRestart: () => calls.push('save'), restartFailed: () => calls.push('discard') });
  await manager.check(); await manager.install();
  native.emit('update-downloaded');
  assert.deepEqual(calls, ['save', 'discard']);
  assert.equal(manager.getState().status, 'error');
});
