import type { Dimensions, TerminalAPI } from '../shared/terminal-protocol.ts';

interface Output {
  write(data: string, processed: () => void): void;
  exited(message: string): void;
}

/** Owns the subscription before starting the PTY; ready releases buffered output. */
export class TerminalSession {
  id: string | undefined;
  private closed = false;
  private pendingSize: Dimensions | undefined;
  private unsubscribe: () => void;
  private api: TerminalAPI;
  constructor(api: TerminalAPI, output: Output) {
    this.api = api;
    this.unsubscribe = api.onEvent(event => {
      if (this.closed || event.id !== this.id) return;
      if (event.type === 'data') {
        output.write(event.data, () => {
          if (!this.closed) api.acknowledge(event.id, event.sequence);
        });
      } else output.exited(event.error ?? `Shell exited with status ${event.exitCode}${event.signal ? ` (signal ${event.signal})` : ''}. Open a new tab to start a fresh shell.`);
    });
  }
  async start(size: Dimensions): Promise<void> {
    const id = await this.api.create(size);
    if (this.closed) { await this.api.close(id); return; }
    this.id = id;
    if (this.pendingSize) this.api.resize(id, this.pendingSize.cols, this.pendingSize.rows);
    this.api.ready(id);
  }
  resize(cols: number, rows: number): void {
    if (this.closed) return;
    this.pendingSize = { cols, rows };
    if (this.id) this.api.resize(this.id, cols, rows);
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    if (this.id) await this.api.close(this.id);
  }
}
