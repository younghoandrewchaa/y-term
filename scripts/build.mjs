import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/renderer', { recursive: true });
await build({
  entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.cjs',
  platform: 'node', format: 'cjs', bundle: true, target: 'node22',
  external: ['electron', 'node-pty'], sourcemap: true,
});
await build({
  entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.cjs',
  platform: 'node', format: 'cjs', bundle: true, target: 'node22',
  external: ['electron'], sourcemap: true,
});
await build({
  entryPoints: ['src/renderer/app.ts'], outfile: 'dist/renderer/app.js',
  platform: 'browser', format: 'iife', bundle: true, target: 'chrome140',
  sourcemap: true,
});
await cp('src/renderer/index.html', 'dist/renderer/index.html');
console.log('Built main, sandboxed preload, and renderer.');
