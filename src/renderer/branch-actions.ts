import type { IMarker, Terminal } from '@xterm/xterm';
import { isBranchListCommand, parseBranchLine } from '../shared/branch-list.ts';
import type { BranchList } from '../shared/terminal-protocol.ts';
import type { CommandBlock } from './shell-integration.ts';

export interface BranchLine { line: number; name: string; end: number }

const MAX_BRANCHES = 500;
const COPY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="M5.5 5.5h8v8h-8zM10.5 3V2.5h-8v8H3"/></svg>';
const TRASH = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.6 6.5v4.5M9.4 6.5v4.5"/></svg>';

/** Deletable-looking lines of a successful `git branch` block; `end` is the cell after the name. */
export function branchLines(terminal: Pick<Terminal, 'buffer' | 'cols'>, block: CommandBlock): BranchLine[] {
  const buffer = terminal.buffer.active;
  if (buffer.type !== 'normal' || !block.output || !block.end || block.exitCode !== 0 || !isBranchListCommand(block.command)) return [];
  const lines: BranchLine[] = [];
  for (let y = block.output.line; y < block.end.line && lines.length < MAX_BRANCHES; y++) {
    const line = buffer.getLine(y);
    // Names that wrap are skipped rather than decorated across rows.
    if (!line || line.isWrapped || buffer.getLine(y + 1)?.isWrapped) continue;
    const name = parseBranchLine(line.translateToString(true));
    if (!name) continue;
    let end = 0;
    for (let x = terminal.cols - 1; x >= 0 && !end; x--) {
      const cell = line.getCell(x);
      if (cell?.getChars()) end = x + cell.getWidth();
    }
    lines.push({ line: y, name, end });
  }
  return lines;
}

/** Adds copy and delete buttons after each branch that Git confirms exists in the tab's repository. */
export async function decorateBranches(terminal: Terminal, block: CommandBlock, list: () => Promise<BranchList | undefined>,
  remove: (root: string, name: string) => Promise<boolean>, status: (message: string) => void): Promise<void> {
  const lines = branchLines(terminal, block).filter(({ end }) => end + 5 <= terminal.cols);
  if (!lines.length) return;
  const buffer = terminal.buffer.active;
  const cursor = buffer.baseY + buffer.cursorY;
  const markers = lines.map(({ line }) => terminal.registerMarker(line - cursor));
  let repository: BranchList | undefined;
  try { repository = await list(); } catch (error) { status(String(error)); }
  lines.forEach(({ name, end }, index) => {
    const marker = markers[index];
    if (!marker || marker.isDisposed) return;
    if (!repository?.names.includes(name)) { marker.dispose(); return; }
    addButton(terminal, marker, repository.root, name, end, remove, status);
  });
}

function addButton(terminal: Terminal, marker: IMarker, root: string, name: string, end: number,
  remove: (root: string, name: string) => Promise<boolean>, status: (message: string) => void): void {
  const button = terminal.registerDecoration({ marker, x: end + 1, width: 4 });
  if (!button) { marker.dispose(); return; }
  let busy = false;
  button.onRender(element => {
    if (element.classList.contains('branch-actions')) return;
    element.classList.add('branch-actions');
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'branch-copy';
    copy.title = `Copy branch ${name}`;
    copy.setAttribute('aria-label', copy.title);
    copy.innerHTML = COPY;
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'branch-delete';
    removeButton.title = `Delete branch ${name}`;
    removeButton.setAttribute('aria-label', removeButton.title);
    removeButton.innerHTML = TRASH;
    element.append(copy, removeButton);
    // Keep the click from starting a text selection.
    element.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
    copy.addEventListener('click', event => {
      event.stopPropagation();
      window.terminal.copyBranch(name).then(() => {
        copy.title = `Copied branch ${name}`;
        copy.classList.add('branch-copied');
        setTimeout(() => {
          copy.title = `Copy branch ${name}`;
          copy.classList.remove('branch-copied');
        }, 1500);
      })
        .catch(error => status(String(error)));
    });
    removeButton.addEventListener('click', event => {
      event.stopPropagation();
      if (busy) return;
      busy = true;
      remove(root, name).then(deleted => {
        if (!deleted) return;
        button.dispose();
        terminal.registerDecoration({ marker, x: 2, width: end - 2, layer: 'top' })
          ?.onRender(line => line.classList.add('branch-deleted'));
      }).catch(error => status(String(error))).finally(() => { busy = false; });
    });
  });
}
