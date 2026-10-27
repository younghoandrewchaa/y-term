import type { GitDiffResult } from '../shared/git-protocol.ts';

interface DiffCell { number?: number; text: string }
export interface DiffRow { kind: 'context' | 'change' | 'hunk' | 'notice'; left?: DiffCell; right?: DiffCell }
const notice = (text: string): DiffRow[] => [{ kind: 'notice', right: { text } }];
const MAX_ROWS = 10000;

export function buildDiffRows(diff: GitDiffResult): DiffRow[] {
  if (diff.kind === 'summary') return notice(diff.message);
  if (diff.kind === 'untracked') {
    if (!diff.content) return notice('Empty file.');
    const lines = diff.content.split('\n');
    const finalNewline = lines.at(-1) === '';
    if (finalNewline) lines.pop();
    if (lines.length + (finalNewline ? 0 : 1) > MAX_ROWS) return notice('This diff is too large to display (10,000 row limit).');
    const rows: DiffRow[] = lines.map((text, index) => ({ kind: 'change', left: undefined, right: { number: index + 1, text } }));
    if (!finalNewline) rows.push({ kind: 'notice', right: { text: 'No newline at end of file' } });
    return rows;
  }
  const rows: DiffRow[] = [];
  let left = 0, right = 0, leftRemaining = 0, rightRemaining = 0, hunks = 0;
  type Edit = { cell: DiffCell; noNewline?: boolean };
  let deleted: Edit[] = [], added: Edit[] = [];
  let last: Edit | undefined;
  let context: DiffRow | undefined;
  const flush = () => {
    for (let index = 0; index < Math.max(deleted.length, added.length); index++) {
      const old = deleted[index], current = added[index];
      rows.push({ kind: 'change', left: old?.cell, right: current?.cell });
      if (old?.noNewline || current?.noNewline) rows.push({ kind: 'notice', left: old?.noNewline ? { text: 'No newline at end of file' } : undefined, right: current?.noNewline ? { text: 'No newline at end of file' } : undefined });
    }
    deleted = []; added = []; last = undefined;
  };
  try {
    const lines = diff.patch.split('\n');
    if (lines.at(-1) === '') lines.pop();
    for (const line of lines) {
      if (rows.length + Math.max(deleted.length, added.length) > MAX_ROWS) return notice('This diff is too large to display (10,000 row limit).');
      const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(line);
      if (header) {
        if (leftRemaining || rightRemaining) throw new Error();
        flush(); hunks++;
        left = Number(header[1]); right = Number(header[3]);
        leftRemaining = header[2] === undefined ? 1 : Number(header[2]);
        rightRemaining = header[4] === undefined ? 1 : Number(header[4]);
        rows.push({ kind: 'hunk', left: { text: `Line ${left}` }, right: { text: `Line ${right}` } });
        context = undefined;
      } else if (line === '\\ No newline at end of file') {
        if (last) last.noNewline = true;
        else if (context) rows.push({ kind: 'notice', left: { text: 'No newline at end of file' }, right: { text: 'No newline at end of file' } });
        else throw new Error();
      } else if (leftRemaining || rightRemaining) {
        const text = line.slice(1);
        context = undefined;
        if (line[0] === ' ') {
          if (!leftRemaining || !rightRemaining) throw new Error();
          flush(); leftRemaining--; rightRemaining--;
          context = { kind: 'context', left: { number: left++, text }, right: { number: right++, text } };
          rows.push(context);
        } else if (line[0] === '-' && leftRemaining > 0) {
          last = { cell: { number: left++, text } }; deleted.push(last); leftRemaining--;
        } else if (line[0] === '+' && rightRemaining > 0) {
          last = { cell: { number: right++, text } }; added.push(last); rightRemaining--;
        } else throw new Error();
      } else {
        if (line.startsWith('@@@')) throw new Error();
        // Ignore Git's metadata, but never accept stray patch lines after a hunk.
        if (hunks && /^[ +\\-]/.test(line) && !line.startsWith('--- ') && !line.startsWith('+++ ')) throw new Error();
        flush(); context = undefined;
      }
    }
    if (leftRemaining || rightRemaining || !hunks) throw new Error();
    flush();
    return rows.length > MAX_ROWS ? notice('This diff is too large to display (10,000 row limit).') : rows;
  } catch { return notice('This patch format cannot be displayed. Refresh or inspect it in the terminal.'); }
}
