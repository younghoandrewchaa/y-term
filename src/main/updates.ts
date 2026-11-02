import type { UpdateState } from '../shared/update-protocol.ts';

export const releaseRepository = 'younghoandrewchaa/y-term';
export const updateManifestName = 'update-darwin-arm64.json';
const latestManifestUrl = `https://github.com/${releaseRepository}/releases/latest/download/${updateManifestName}`;

export async function fetchLatestRelease(fetcher: (url: string, options: RequestInit) => Promise<Response>): Promise<unknown> {
  const response = await fetcher(latestManifestUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  return response.json();
}
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
  if (typeof release.currentRelease !== 'string') return;
  const version = release.currentRelease;
  const next = stableVersion(version), current = stableVersion(currentVersion);
  if (!next || !current) return;
  const difference = next.map((part, i) => part - current[i]).find(part => part !== 0);
  if (!difference || difference < 0 || !Array.isArray(release.releases)) return;
  const base = `https://github.com/${releaseRepository}/releases/download/v${version}/`;
  const hasAsset = release.releases.some((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return false;
    const item = entry as Record<string, unknown>;
    if (item.version !== version || !item.updateTo || typeof item.updateTo !== 'object') return false;
    return (item.updateTo as Record<string, unknown>).url === `${base}Y-Term-darwin-arm64-${version}.zip`;
  });
  if (!hasAsset) return;
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
  /** Runs just before quitting to install; failures must not block the update. */
  beforeRestart?(version: string): void;
  /** Undoes `beforeRestart` when the restart could not begin. */
  restartFailed?(): void;
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
    try { if (this.candidate) this.options.beforeRestart?.(this.candidate.version); }
    catch (error) { console.error('Could not save tabs before restarting:', error); }
    try { this.options.native.quitAndInstall(); }
    catch {
      try { this.options.restartFailed?.(); } catch { /* Best effort; the version check also ignores stale tabs. */ }
      this.setState('error', 'Could not restart. Try again.');
    }
  }
}
