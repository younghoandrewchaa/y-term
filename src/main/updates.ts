import type { UpdateState } from '../shared/update-protocol.ts';

export const releaseRepository = 'younghoandrewchaa/y-term';
export const releaseApiUrl = `https://api.github.com/repos/${releaseRepository}/releases/latest`;
export const updateManifestName = 'update-darwin-arm64.json';
const cooldown = 5 * 60_000;

interface Release { version: string; feedUrl: string }
function stableVersion(value: unknown): number[] | undefined {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return;
  const parts = value.split('.').map(Number);
  if (parts.every(Number.isSafeInteger)) return parts;
}

export function selectRelease(value: unknown, currentVersion: string): Release | undefined {
  if (!value || typeof value !== 'object') return;
  const release = value as Record<string, unknown>;
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string') return;
  const version = release.tag_name.replace(/^v/, '');
  const next = stableVersion(version), current = stableVersion(currentVersion);
  if (!next || !current) return;
  const difference = next.map((part, i) => part - current[i]).find(part => part !== 0);
  if (!difference || difference < 0 || !Array.isArray(release.assets)) return;
  const assets = release.assets;
  const base = `https://github.com/${releaseRepository}/releases/download/${release.tag_name}/`;
  const hasAsset = (name: string) => assets.some((asset: unknown) => {
    if (!asset || typeof asset !== 'object') return false;
    const entry = asset as Record<string, unknown>;
    return entry.name === name && entry.browser_download_url === `${base}${name}`;
  });
  if (!hasAsset(`Y-Term-darwin-arm64-${version}.zip`) || !hasAsset(updateManifestName)) return;
  return { version, feedUrl: `${base}${updateManifestName}` };
}

interface NativeUpdater {
  on(event: string, listener: (...args: any[]) => void): unknown;
  setFeedURL(options: { url: string; serverType: 'json' }): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
}
interface UpdateOptions {
  version: string;
  enabled: boolean;
  native: NativeUpdater;
  fetchRelease(): Promise<unknown>;
  confirm(): Promise<boolean>;
  publish(state: UpdateState): void;
  now?: () => number;
}

export class UpdateManager {
  private state: UpdateState;
  private candidate?: Release;
  private lastCheck = -Infinity;
  private downloaded = false;
  private options: UpdateOptions;

  constructor(options: UpdateOptions) {
    this.options = options;
    this.state = { version: options.version, status: options.enabled ? 'idle' : 'disabled' };
    options.native.on('error', () => {
      if (this.state.status === 'downloading' || this.state.status === 'installing') {
        this.setState('error', 'Update failed. Try again.');
      }
    });
    options.native.on('update-not-available', () => {
      if (this.state.status !== 'downloading') return;
      this.candidate = undefined;
      this.setState('idle');
    });
    options.native.on('update-downloaded', () => {
      if (this.state.status !== 'downloading') return;
      this.downloaded = true;
      this.restart();
    });
  }

  getState(): UpdateState { return { ...this.state }; }
  get isInstalling(): boolean { return this.state.status === 'installing'; }
  private get busy(): boolean { return ['checking', 'confirming', 'downloading', 'installing'].includes(this.state.status); }
  private setState(status: UpdateState['status'], message?: string): void {
    this.state = { version: this.options.version, status,
      ...(this.candidate ? { latestVersion: this.candidate.version } : {}), ...(message ? { message } : {}) };
    this.options.publish(this.getState());
  }

  async check(force = false): Promise<void> {
    if (!this.options.enabled || this.busy || this.downloaded) return;
    const now = (this.options.now ?? Date.now)();
    if (!force && now - this.lastCheck < cooldown) return;
    this.lastCheck = now;
    this.setState('checking');
    try {
      this.candidate = selectRelease(await this.options.fetchRelease(), this.options.version);
      this.setState(this.candidate ? 'available' : 'idle');
    } catch {
      this.setState('error', 'Could not check for updates.');
    }
  }

  async install(): Promise<void> {
    if (!this.options.enabled || this.busy || !this.candidate) return;
    this.setState('confirming');
    try {
      if (!await this.options.confirm()) { this.setState('available'); return; }
      if (this.downloaded) { this.restart(); return; }
      this.setState('downloading');
      this.options.native.setFeedURL({ url: this.candidate.feedUrl, serverType: 'json' });
      this.options.native.checkForUpdates();
    } catch {
      this.setState('error', 'Update failed. Try again.');
    }
  }

  private restart(): void {
    this.setState('installing');
    try { this.options.native.quitAndInstall(); }
    catch { this.setState('error', 'Could not restart. Try again.'); }
  }
}
