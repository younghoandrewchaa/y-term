import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Preferences } from '../shared/terminal-protocol.ts';
import { TerminalSession } from './terminal-session.ts';

export class TerminalView {
  readonly terminal: Terminal;
  readonly search = new SearchAddon();
  private fitAddon = new FitAddon();
  private session: TerminalSession;
  private observer: ResizeObserver;
  private disposed = false;
  private host: HTMLElement;

  constructor(host: HTMLElement, preferences: Preferences, title: (value: string) => void, status: (message: string) => void, confirmPaste: (text: string) => Promise<boolean>) {
    this.host = host;
    this.terminal = new Terminal({ cursorBlink: true, allowProposedApi: false });
    this.apply(preferences);
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(this.search);
    this.terminal.loadAddon(new WebLinksAddon((event, uri) => {
      if (event.metaKey || event.ctrlKey) void window.terminal.openLink(uri).catch(error => status(String(error)));
    }));
    this.terminal.open(host);
    this.session = new TerminalSession(window.terminal, {
      write: (data, processed) => this.terminal.write(data, processed),
      exited: message => { this.terminal.options.disableStdin = true; status(message); },
    });
    this.terminal.onData(data => { if (this.session.id) window.terminal.write(this.session.id, data); });
    this.terminal.onBinary(data => { if (this.session.id) window.terminal.write(this.session.id, data, true); });
    this.terminal.onResize(({ cols, rows }) => {
      this.session.resize(cols, rows);
    });
    this.terminal.onTitleChange(value => title(value.slice(0, 160)));
    host.addEventListener('paste', event => {
      const text = event.clipboardData?.getData('text/plain');
      if (!text || !/[\r\n]/.test(text)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void confirmPaste(text).then(approved => {
        if (approved && !this.disposed) { this.terminal.paste(text); this.terminal.focus(); }
      });
    }, true);
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(host);
  }
  async start(): Promise<void> {
    await document.fonts.ready;
    if (this.disposed) return;
    this.fit();
    await this.session.start({ cols: this.terminal.cols, rows: this.terminal.rows });
    if (!this.disposed) this.host.closest('[role=tabpanel]')?.setAttribute('data-ready', 'true');
  }
  fit(): void {
    if (this.disposed || !this.host.clientWidth || !this.host.clientHeight) return;
    const size = this.fitAddon.proposeDimensions();
    if (size && Number.isFinite(size.cols) && Number.isFinite(size.rows)) {
      this.terminal.resize(Math.max(2, Math.min(1000, size.cols)), Math.max(1, Math.min(500, size.rows)));
    }
  }
  focus(): void { this.fit(); this.terminal.focus(); }
  apply(preferences: Preferences): void {
    this.terminal.options.fontFamily = preferences.fontFamily;
    this.terminal.options.fontSize = preferences.fontSize;
    this.terminal.options.scrollback = preferences.scrollback;
    this.terminal.options.theme = preferences.theme === 'dark'
      ? { background: '#101113', foreground: '#e5e7eb', cursor: '#a6e3a1', selectionBackground: '#39536b' }
      : { background: '#faf9f6', foreground: '#23262b', cursor: '#24543c', selectionBackground: '#bfd6ec' };
  }
  async close(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    this.terminal.dispose();
    await this.session.close();
  }
}
