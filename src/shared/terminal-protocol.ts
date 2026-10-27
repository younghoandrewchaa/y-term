import type { AgentResume } from './agent-resume.ts';
import type { UpdateState } from './update-protocol.ts';

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
  | { type: 'agent'; id: string; agent?: string }
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
export interface RestoredTab { cwd?: string; resume?: AgentResume }
/** Tabs for one window after an update restart, in sidebar order. */
export interface RestoredTabs { tabs: RestoredTab[]; active: number }
export type MenuAction = 'new-tab' | 'close-tab' | 'find' | 'settings' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'clear' | 'next-tab' | 'previous-tab' | 'toggle-sidebar';
export interface TerminalAPI {
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
  getPathForFile(file: File): string;
  /** Starts in `sourceId`'s live directory, otherwise in `cwd` when it is usable. */
  create(size: Dimensions, sourceId?: string, cwd?: string): Promise<string>;
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
  /** Opens a VS Code diff for files with Git changes unless `plain` is set. */
  openFile(id: string, path: string, plain?: boolean): Promise<void>;
  setAttentionCount(count: number): void;
  notifyAttention(tab: string, title: string, body: string): void;
  onAttentionActivate(listener: (tab: string) => void): () => void;
  /** Reports sidebar order so an update restart can reopen tabs in the same order. */
  setLayout(ids: string[], active?: string): void;
  /** Returns this window's tabs saved before an update restart, once. */
  takeRestoredTabs(): Promise<RestoredTabs | undefined>;
}

declare global { interface Window { terminal: TerminalAPI } }
