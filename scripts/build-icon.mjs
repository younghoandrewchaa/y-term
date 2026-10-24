import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../assets/icon.png', import.meta.url));
const destination = fileURLToPath(new URL('../assets/icon.icns', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'y-term-icon-'));
try {
  // ICNS is a length-prefixed container; modern macOS accepts PNG payloads.
  const entries = [];
  for (const [type, size] of [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]]) {
    const resized = join(temporary, `${type}.png`);
    execFileSync('/usr/bin/sips', ['-z', String(size), String(size), source, '--out', resized], { stdio: 'ignore' });
    const png = await readFile(resized);
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(png.length + 8, 4);
    entries.push(header, png);
  }
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(8 + entries.reduce((total, entry) => total + entry.length, 0), 4);
  await writeFile(destination, Buffer.concat([header, ...entries]));
  console.log('Built assets/icon.icns (16–1024 pixels).');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
