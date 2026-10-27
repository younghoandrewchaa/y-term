import { spawn } from 'node:child_process';
import { constants, rmSync } from 'node:fs';
import { access, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, parse } from 'node:path';

// Apps opened from Finder get a minimal PATH, so also check the usual install locations.
const fallbacks = ['/usr/local/bin/code', '/opt/homebrew/bin/code', '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'];

export async function findCode(path = process.env.PATH ?? '', candidates = fallbacks): Promise<string | undefined> {
  for (const candidate of [...path.split(delimiter).filter(Boolean).map(directory => join(directory, 'code')), ...candidates]) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* Try the next location. */ }
  }
  return undefined;
}

/** Opens VS Code's diff editor against a read-only temporary copy of the previous version. */
export class VsCodeDiff {
  private directory?: string;
  private options: { root?: string; find?: () => Promise<string | undefined> };
  constructor(options: { root?: string; find?: () => Promise<string | undefined> } = {}) { this.options = options; }

  /** Returns false when VS Code is not installed, so the caller can open the file normally. */
  async open(file: string, label: string, previous: Buffer): Promise<boolean> {
    const code = await (this.options.find ?? findCode)();
    if (!code) return false;
    this.directory ??= await mkdtemp(join(this.options.root ?? tmpdir(), 'y-term-diff-'));
    // Keep the extension so VS Code picks the same language for both sides.
    const { name, ext } = parse(basename(file));
    const left = join(await mkdtemp(join(this.directory, 'file-')), `${name} (${label})${ext}`);
    await writeFile(left, previous, { mode: 0o444 });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('ELECTRON_') && key !== 'NODE_OPTIONS'));
    await new Promise<void>((resolve, reject) => {
      const child = spawn(code, ['--diff', left, file], { env, detached: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
    return true;
  }

  dispose(): void {
    if (this.directory) rmSync(this.directory, { recursive: true, force: true });
    this.directory = undefined;
  }
}
