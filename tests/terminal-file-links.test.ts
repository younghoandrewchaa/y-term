import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { ILink, Terminal as XtermTerminal } from '@xterm/xterm';
import { createFileLinkProvider } from '../src/renderer/file-links.ts';

const { Terminal } = createRequire(import.meta.url)('@xterm/xterm') as { Terminal: typeof XtermTerminal };

async function fixture(text: string, cols = 160) {
  const terminal = new Terminal({ cols, rows: 24 });
  await new Promise<void>(resolve => terminal.write(text, resolve));
  const activated: string[] = [];
  const provider = createFileLinkProvider(terminal, (_event, path) => activated.push(path));
  const links = (row = 1) => {
    let result: ILink[] = [];
    provider.provideLinks(row, value => { result = value ?? []; });
    return result;
  };
  return { terminal, links, activated };
}

test('finds paths in Codex prose and excludes surrounding Markdown punctuation', async () => {
  const f = await fixture('Created the implementation plan (docs/plans/plan.md) and proposed design (`docs/specs/design.md`).');
  try {
    assert.deepEqual(f.links().map(link => link.text), ['docs/plans/plan.md', 'docs/specs/design.md']);
    const link = f.links()[0];
    assert.equal(link.range.start.x, 34);
    link.activate({} as MouseEvent, link.text);
    assert.deepEqual(f.activated, ['docs/plans/plan.md']);
  } finally { f.terminal.dispose(); }
});

test('recognises quoted spaces, home and absolute paths, filenames, and line suffixes', async () => {
  const f = await fixture('"docs/my plan.md" \'/tmp/my file.md\' ~/plan.md /tmp/plan.md README.md src/app.ts:12:4.');
  try {
    assert.deepEqual(f.links().map(link => link.text), ['docs/my plan.md', '/tmp/my file.md', '~/plan.md', '/tmp/plan.md', 'README.md', 'src/app.ts:12:4']);
  } finally { f.terminal.dispose(); }
});

test('preserves complete paths and coordinates across wrapped rows', async () => {
  const path = 'docs/superpowers/plans/plan.md';
  const f = await fixture(`Created (${path}).`, 20);
  try {
    const first = f.links(1)[0];
    assert.equal(first.text, path);
    assert.deepEqual(first.range, { start: { x: 10, y: 1 }, end: { x: (9 + path.length - 1) % 20 + 1, y: Math.floor((9 + path.length - 1) / 20) + 1 } });
    assert.deepEqual(f.links(2).map(link => link.text), [path]);
  } finally { f.terminal.dispose(); }
});

test('positions links after wide and combining characters using terminal cells', async () => {
  const f = await fixture('界 e\u0301 docs/计划.md');
  try {
    assert.deepEqual(f.links()[0].range, { start: { x: 6, y: 1 }, end: { x: 17, y: 1 } });
    assert.equal(f.links()[0].text, 'docs/计划.md');
  } finally { f.terminal.dispose(); }
});

test('does not detect web URLs or arbitrary protocols as file paths', async () => {
  const f = await fixture('https://example.com/docs/plan.md javascript:alert(1) data:text/plain,foo normal prose');
  try { assert.deepEqual(f.links(), []); }
  finally { f.terminal.dispose(); }
});

test('apostrophes in prose do not consume file references as quoted paths', async () => {
  for (const text of ["I've updated docs/plan.md and it's ready.", "I've updated `docs/plan.md` and it's ready."]) {
    const f = await fixture(text);
    try { assert.deepEqual(f.links().map(link => link.text), ['docs/plan.md']); }
    finally { f.terminal.dispose(); }
  }
});
