import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Preferences } from '../shared/terminal-protocol.ts';
import { TerminalSession } from './terminal-session.ts';
import { attachTerminalFileDrop } from './file-drop.ts';

export class TerminalView {
  readonly terminal: Terminal;
  readonly search = new SearchAddon();
  private fitAddon = new FitAddon();
  private session: TerminalSession;
  private observer: ResizeObserver;
  private disposed = false;
  private exited = false;
  private removeFileDrop: () => void;
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
      exited: message => { this.exited = true; this.terminal.options.disableStdin = true; status(message); },
    });
    this.removeFileDrop = attachTerminalFileDrop(host, {
      canPaste: () => !!this.session.id && !this.exited && !this.disposed && host.isConnected
        && !host.closest('[hidden]') && !document.querySelector('dialog[open]'),
      getPathForFile: file => window.terminal.getPathForFile(file),
      paste: text => this.terminal.paste(text),
      focus: () => this.terminal.focus(),
      report: status,
    });
    this.terminal.onData(data => { if (this.session.id) window.terminal.write(this.session.id, data); });
    this.terminal.attachCustomKeyEventHandler(event => {
      if (event.key === 'Backspace' && event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.isComposing) {
        if (event.type === 'keydown') {
          event.preventDefault();
          // Ctrl+U deletes back to the beginning of the shell input line.
          this.terminal.input('\x15');
        }
        return false;
      }
      if (event.key !== 'Enter' || !event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return true;
      if (event.type === 'keydown') {
        event.preventDefault();
        // CSI u preserves Shift so terminal agents can insert a newline.
        this.terminal.input('\x1b[13;2u');
      }
      return false;
    });
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
      ? {
        background: '#101216', foreground: '#dcdfe5', cursor: '#7aa2ff', cursorAccent: '#101216',
        selectionBackground: '#7aa2ff40', selectionInactiveBackground: '#7aa2ff26',
        black: '#171a20', red: '#f28b91', green: '#3dd68c', yellow: '#e8c47f',
        blue: '#8fb8ff', magenta: '#d3a6ff', cyan: '#80d4d0', white: '#dcdfe5',
        brightBlack: '#7c8290', brightRed: '#ffa3a8', brightGreen: '#72e4ad', brightYellow: '#f5d99c',
        brightBlue: '#b4ceff', brightMagenta: '#e2c3ff', brightCyan: '#a3e8e4', brightWhite: '#eef0f3',
      }
      : {
        background: '#faf9f6', foreground: '#23262b', cursor: '#4269c2', cursorAccent: '#faf9f6',
        selectionBackground: '#4269c230', selectionInactiveBackground: '#4269c21c',
        black: '#23262b', red: '#b53847', green: '#237a51', yellow: '#896017',
        blue: '#3564b4', magenta: '#8b4bb0', cyan: '#247775', white: '#59616b',
        brightBlack: '#6e7480', brightRed: '#c44050', brightGreen: '#278658', brightYellow: '#95691c',
        brightBlue: '#4269c2', brightMagenta: '#9658bb', brightCyan: '#2d8583', brightWhite: '#23262b',
      };
  }
  async close(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.removeFileDrop();
    this.observer.disconnect();
    this.terminal.dispose();
    await this.session.close();
  }
}
