import type { IDisposable, IMarker, Terminal } from '@xterm/xterm';
import { parseCommandLine, parseOsc133 } from '../shared/shell-integration.ts';
import type { ShellMark } from '../shared/shell-integration.ts';

export interface CommandBlock { prompt: IMarker; output?: IMarker; end?: IMarker; command?: string; exitCode?: number }

const MAX_BLOCKS = 1000;

export class CommandTracker {
  nonce: string | undefined;
  private list: CommandBlock[] = [];
  private pending: string | undefined;
  private terminal: Pick<Terminal, 'registerMarker' | 'parser'>;
  private handlers: IDisposable[];
  private listeners = new Map<CommandBlock, IDisposable>();
  get blocks(): readonly CommandBlock[] { return this.list; }

  constructor(terminal: Pick<Terminal, 'registerMarker' | 'parser'>) {
    this.terminal = terminal;
    this.handlers = [
      terminal.parser.registerOscHandler(133, data => { const mark = parseOsc133(data); if (mark) this.mark(mark); return true; }),
      terminal.parser.registerOscHandler(633, data => {
        const command = parseCommandLine(data, this.nonce);
        if (command !== undefined) this.pending = command;
        return true;
      }),
    ];
  }

  private mark(mark: ShellMark): void {
    if (mark.kind === 'prompt') {
      this.pending = undefined;
      const prompt = this.terminal.registerMarker(0);
      if (!prompt) return;
      const block: CommandBlock = { prompt };
      this.list.push(block);
      this.listeners.set(block, prompt.onDispose(() => this.remove(block)));
      if (this.list.length > MAX_BLOCKS) this.release(this.list[0]);
      return;
    }
    const block = this.list[this.list.length - 1];
    if (!block || block.end) return;
    if (mark.kind === 'output') {
      block.output = this.terminal.registerMarker(0);
      block.command = this.pending;
      this.pending = undefined;
    } else if (mark.kind === 'finished') {
      block.end = this.terminal.registerMarker(0);
      block.exitCode = mark.exitCode;
    }
  }

  private remove(block: CommandBlock): void {
    const index = this.list.indexOf(block);
    if (index >= 0) this.list.splice(index, 1);
    this.listeners.get(block)?.dispose();
    this.listeners.delete(block);
    block.output?.dispose();
    block.end?.dispose();
  }

  private release(block: CommandBlock): void {
    this.remove(block);
    block.prompt.dispose();
  }

  dispose(): void {
    for (const handler of this.handlers) handler.dispose();
    for (const block of [...this.list]) this.release(block);
  }
}
