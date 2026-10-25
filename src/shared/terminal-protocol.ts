export interface Disposable { dispose(): void }
export interface PtyProcess {
  pid: number;
  onData(listener: (data: string) => void): Disposable;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): Disposable;
  write(data: string | Buffer): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  kill(signal?: string): void;
}

export interface Dimensions { cols: number; rows: number }
export type TerminalEvent =
  | { type: 'data'; id: string; sequence: number; data: string }
  | { type: 'directory'; id: string; cwd: string }
  | { type: 'exit'; id: string; exitCode: number; signal?: number; error?: string };
export interface WindowBounds { x: number; y: number; width: number; height: number }
export interface Preferences {
  fontFamily: string;
  fontSize: number;
  theme: 'dark' | 'light';
  scrollback: number;
  shell: string;
  cwd: string;
  sidebarWidth?: number;
  bounds?: WindowBounds;
}
export type MenuAction = 'new-tab' | 'close-tab' | 'find' | 'settings' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'clear' | 'next-tab' | 'previous-tab';
export interface TerminalAPI {
  getPathForFile(file: File): string;
  create(size: Dimensions, sourceId?: string): Promise<string>;
  ready(id: string): void;
  write(id: string, data: string, binary?: boolean): void;
  resize(id: string, cols: number, rows: number): void;
  acknowledge(id: string, sequence: number): void;
  close(id: string): Promise<void>;
  onEvent(listener: (event: TerminalEvent) => void): () => void;
  onAction(listener: (action: MenuAction) => void): () => void;
  getPreferences(): Promise<Preferences>;
  savePreferences(value: Preferences): Promise<Preferences>;
  openLink(url: string): Promise<void>;
}

declare global { interface Window { terminal: TerminalAPI } }
