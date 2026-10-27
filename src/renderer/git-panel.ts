import type { TerminalAPI } from '../shared/terminal-protocol.ts';
import type { GitDiffResult, GitSection, GitStatusResult } from '../shared/git-protocol.ts';
import { buildDiffRows } from './git-diff.ts';

type GitAPI = Pick<TerminalAPI, 'getGitStatus' | 'getGitDiff'>;
interface Scheduler { schedule(fn: () => void, ms: number): unknown; cancel(token: unknown): void }
interface PanelState {
  visible: boolean; focused: boolean; busy: boolean; section: GitSection;
  session?: string; status?: GitStatusResult; selected?: string; diff?: GitDiffResult;
}
const scheduler: Scheduler = { schedule: (fn, ms) => setTimeout(fn, ms), cancel: token => clearTimeout(token as ReturnType<typeof setTimeout>) };

export class GitPanelController {
  state: PanelState = { visible: false, focused: true, busy: false, section: 'unstaged' };
  private api: GitAPI;
  private changed: (state: PanelState) => void;
  private scheduler: Scheduler;
  private generation = 0;
  private disposed = false;
  private timer: unknown;
  private inFlight?: Promise<void>;
  private queued = false;
  constructor(api: GitAPI, changed: (state: PanelState) => void, clock: Scheduler = scheduler) {
    this.api = api; this.changed = changed; this.scheduler = clock;
  }
  private emit(update: Partial<PanelState>): void { this.state = { ...this.state, ...update }; this.changed(this.state); }
  private stopTimer(): void { if (this.timer !== undefined) this.scheduler.cancel(this.timer); this.timer = undefined; }
  private active(): boolean { return !this.disposed && this.state.visible && this.state.focused && !!this.state.session; }
  private invalidate(update: Partial<PanelState>): void {
    this.generation++; this.stopTimer(); this.emit({ busy: false, ...update });
    if (this.active()) void this.refresh();
  }
  setSession(session: string | undefined): void {
    if (session === this.state.session || this.disposed) return;
    this.invalidate({ session, status: undefined, selected: undefined, diff: undefined });
  }
  directoryChanged(): void { if (!this.disposed) this.invalidate({ status: undefined, selected: undefined, diff: undefined }); }
  setVisible(visible: boolean): void {
    if (visible === this.state.visible || this.disposed) return;
    this.invalidate({ visible });
  }
  setFocused(focused: boolean): void {
    if (focused === this.state.focused || this.disposed) return;
    this.invalidate({ focused });
  }
  setSection(section: GitSection): void {
    if (section === this.state.section || this.disposed) return;
    this.invalidate({ section, selected: undefined, diff: undefined });
  }
  select(path: string): void {
    if (this.disposed || this.state.selected === path || this.state.status?.kind !== 'ready'
      || !this.state.status.entries.some(e => e.path === path && e.section === this.state.section)) return;
    this.invalidate({ selected: path, diff: undefined });
  }
  refresh(): Promise<void> {
    this.stopTimer();
    if (!this.active()) return Promise.resolve();
    if (this.inFlight) { this.queued = true; return this.inFlight; }
    const generation = this.generation;
    const { session, section } = this.state;
    const current = () => this.active() && generation === this.generation;
    this.emit({ busy: true });
    this.inFlight = (async () => {
      try {
        const status = await this.api.getGitStatus(session!);
        if (!current()) return;
        if (status.kind !== 'ready') { this.emit({ status, selected: undefined, diff: undefined }); return; }
        const sameRoot = this.state.status?.kind === 'ready' && this.state.status.root === status.root;
        const entries = status.entries.filter(e => e.section === section);
        const selected = (sameRoot && entries.some(e => e.path === this.state.selected) ? this.state.selected : entries[0]?.path);
        this.emit({ status, selected, ...(!sameRoot || selected !== this.state.selected ? { diff: undefined } : {}) });
        if (!selected) { this.emit({ diff: undefined }); return; }
        const diff = await this.api.getGitDiff(session!, section, selected);
        if (!current()) return;
        this.emit({ diff: diff.kind !== 'summary' && diff.root !== status.root
          ? { kind: 'summary', reason: 'stale', message: 'The repository changed during loading. Refresh to try again.' } : diff });
      } catch (error) {
        if (current()) this.emit({ status: { kind: 'unavailable', reason: 'error', message: error instanceof Error ? error.message : 'Could not read Git changes.' }, selected: undefined, diff: undefined });
      }
    })().finally(() => {
      this.inFlight = undefined;
      if (!this.disposed) this.emit({ busy: false });
      if (this.queued) { this.queued = false; if (this.active()) void this.refresh(); }
      else if (this.active()) this.timer = this.scheduler.schedule(() => { this.timer = undefined; void this.refresh(); }, 2000);
    });
    return this.inFlight;
  }
  dispose(): void { this.disposed = true; this.generation++; this.queued = false; this.stopTimer(); }
}

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const result = document.createElement(tag); result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
};
export class GitPanel {
  private host: HTMLElement;
  private controller: GitPanelController;
  private restoreTerminalFocus: () => void;
  private observer: ResizeObserver;
  private expanded = false;
  private preferredWidth?: number;
  private listKey = '';
  private diffKey = '';
  private remove: (() => void)[] = [];
  private get<T extends HTMLElement = HTMLElement>(id: string): T { return this.host.querySelector(`#${id}`) as T; }
  constructor(host: HTMLElement, api: GitAPI, restoreTerminalFocus: () => void) {
    this.host = host; this.restoreTerminalFocus = restoreTerminalFocus;
    this.controller = new GitPanelController(api, state => this.render(state));
    const on = (target: EventTarget, name: string, listener: EventListener) => { target.addEventListener(name, listener); this.remove.push(() => target.removeEventListener(name, listener)); };
    this.get('git-refresh').onclick = () => { void this.refresh(); };
    this.get('git-close').onclick = () => this.toggle();
    this.get('git-expand').onclick = () => { this.expanded = !this.expanded; this.layout(); };
    for (const section of ['unstaged', 'staged'] as const) this.get(`git-${section}`).onclick = () => this.controller.setSection(section);
    on(host, 'keydown', event => {
      const key = event as KeyboardEvent;
      if (document.querySelector('dialog[open]')) return;
      if (key.key === 'Escape') { key.preventDefault(); key.stopPropagation(); this.toggle(); }
    });
    on(window, 'focus', () => this.controller.setFocused(!document.hidden));
    on(window, 'blur', () => this.controller.setFocused(false));
    on(document, 'visibilitychange', () => this.controller.setFocused(!document.hidden && document.hasFocus()));
    const divider = this.get('git-divider');
    let dragging = false;
    const resize = (width: number) => { this.preferredWidth = width; this.layout(); };
    on(divider, 'pointerdown', event => {
      const pointer = event as PointerEvent; if (pointer.button !== 0) return;
      pointer.preventDefault(); dragging = true; divider.setPointerCapture(pointer.pointerId);
    });
    on(divider, 'pointermove', event => { if (dragging) resize(host.getBoundingClientRect().right - (event as PointerEvent).clientX); });
    on(divider, 'pointerup', () => { dragging = false; });
    on(divider, 'lostpointercapture', () => { dragging = false; });
    on(divider, 'keydown', event => {
      const key = event as KeyboardEvent;
      if (key.key === 'ArrowLeft' || key.key === 'ArrowRight') { key.preventDefault(); resize(host.clientWidth + (key.key === 'ArrowLeft' ? 32 : -32)); }
    });
    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(host.parentElement!);
    this.controller.setFocused(document.hasFocus());
  }
  setSession(id: string | undefined): void { this.controller.setSession(id); }
  directoryChanged(): void { this.controller.directoryChanged(); }
  toggle(): void {
    const visible = !this.controller.state.visible;
    this.controller.setVisible(visible);
    if (visible) this.get('git-close').focus(); else this.restoreTerminalFocus();
  }
  refresh(): Promise<void> { return this.controller.refresh(); }
  private layout(): void {
    const visible = this.controller.state.visible;
    const width = this.host.parentElement!.clientWidth;
    const full = this.expanded || width < 1100;
    this.host.classList.toggle('git-full', full);
    (document.getElementById('panels') as HTMLElement).hidden = visible && full;
    this.host.style.width = full ? '100%' : `${Math.max(720, Math.min(width - 320, this.preferredWidth ?? width * .65))}px`;
    this.get('git-divider').hidden = full;
    this.get('git-divider').setAttribute('aria-valuemin', '720');
    this.get('git-divider').setAttribute('aria-valuemax', String(Math.max(720, width - 320)));
    this.get('git-divider').setAttribute('aria-valuenow', String(Math.round(this.host.clientWidth)));
    const expand = this.get<HTMLButtonElement>('git-expand');
    expand.textContent = this.expanded ? 'Restore' : 'Expand';
    expand.disabled = width < 1100 && !this.expanded;
  }
  private render(state: PanelState): void {
    this.host.hidden = !state.visible;
    this.host.setAttribute('aria-busy', String(state.busy));
    document.getElementById('changes-toggle')?.setAttribute('aria-expanded', String(state.visible));
    this.layout();
    const root = state.status?.kind === 'ready' ? state.status.root : '';
    this.get('git-repository').textContent = root ? root.split('/').at(-1)! : 'Changes';
    this.get('git-repository').title = root;
    const entries = state.status?.kind === 'ready' ? state.status.entries.filter(e => e.section === state.section) : [];
    for (const section of ['unstaged', 'staged'] as const) {
      const count = state.status?.kind === 'ready' ? state.status.entries.filter(e => e.section === section).length : 0;
      const button = this.get(`git-${section}`);
      button.textContent = `${section === 'unstaged' ? 'Unstaged' : 'Staged'} ${count}`;
      button.setAttribute('aria-pressed', String(section === state.section));
    }
    const message = !state.session ? 'Open a terminal session to view changes.' : state.status?.kind === 'unavailable' ? state.status.message
      : !state.status ? (state.busy ? 'Reading Git changes…' : 'Ready to read changes.')
      : !entries.length ? (state.section === 'staged' ? 'No staged changes.' : 'Working tree is clean.')
      : state.busy ? 'Refreshing…' : `${entries.length} ${entries.length === 1 ? 'file' : 'files'} · Read only`;
    this.get('git-message').textContent = message;
    const listKey = JSON.stringify([root, state.section, entries]);
    if (listKey !== this.listKey) {
      this.listKey = listKey;
      const list = this.get('git-files'); list.replaceChildren();
      for (const entry of entries) {
        const item = node('li', 'git-file-item');
        const button = node('button', 'git-file'); button.type = 'button'; button.dataset.path = entry.path;
        button.title = entry.originalPath ? `${entry.originalPath} → ${entry.path}` : entry.path;
        button.setAttribute('aria-label', `${entry.path}, ${entry.kind}`);
        const badge = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: '?', conflicted: '!', submodule: 'S', 'type-changed': 'T', 'unsupported-path': '!' }[entry.kind];
        button.append(node('span', `git-badge git-${entry.kind}`, badge), node('span', 'git-file-path', entry.path));
        button.onclick = () => this.controller.select(entry.path);
        button.onkeydown = event => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const index = entries.indexOf(entry);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : Math.max(0, Math.min(entries.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
          this.controller.select(entries[next].path);
          (list.children[next].firstElementChild as HTMLElement).focus();
        };
        item.append(button); list.append(item);
      }
    }
    for (const button of this.get('git-files').querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(button.dataset.path === state.selected));
    const selected = entries.find(e => e.path === state.selected);
    this.get('git-file-title').textContent = selected ? (selected.originalPath ? `${selected.originalPath} → ${selected.path}` : selected.path) : 'Select a file to compare';
    const diffKey = JSON.stringify([root, state.section, state.selected, state.diff]);
    if (diffKey !== this.diffKey) {
      this.diffKey = diffKey;
      const table = this.get('git-diff-table'); table.replaceChildren();
      const labels = state.section === 'staged' ? ['HEAD', 'Index'] : [selected?.kind === 'untracked' ? 'Empty' : 'Index', 'Working tree'];
      for (const label of labels) table.append(node('div', 'git-column-heading', label));
      if (state.diff) for (const row of buildDiffRows(state.diff)) {
        for (const side of ['left', 'right'] as const) {
          const cell = row[side];
          const div = node('div', `git-cell git-${row.kind}${cell ? '' : ' git-blank'}${row.kind === 'change' && cell ? side === 'left' ? ' git-removed' : ' git-added' : ''}`);
          const number = node('span', 'git-line-number', cell?.number === undefined ? '' : String(cell.number)); number.setAttribute('aria-hidden', 'true');
          const mark = node('span', 'git-line-mark', row.kind === 'change' && cell ? side === 'left' ? '−' : '+' : ''); mark.setAttribute('aria-hidden', 'true');
          div.append(number, mark, node('code', 'git-code', cell?.text ?? ''));
          table.append(div);
        }
      }
      const scroll = this.get('git-diff'); scroll.scrollTop = 0; scroll.scrollLeft = 0;
    }
  }
  dispose(): void {
    this.controller.dispose(); this.observer.disconnect(); for (const remove of this.remove) remove();
  }
}
