import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { TerminalView } from './terminal-view.ts';
import { attachSidebarResize } from './sidebar-resize.ts';
import type { AttentionSignal } from '../shared/attention.ts';
import { AGENT_LABELS, resumeCommand } from '../shared/agent-resume.ts';
import type { MenuAction, Preferences, RestoredTab } from '../shared/terminal-protocol.ts';
import type { UpdateState } from '../shared/update-protocol.ts';

// A file dropped outside a terminal must not navigate away from the app.
for (const type of ['dragover', 'drop'] as const) {
  document.addEventListener(type, event => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'none';
  });
}

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tablist = element('tabs');
const panels = element('panels');
const message = element('message');
const settings = element<HTMLDialogElement>('settings');
const settingsForm = element<HTMLFormElement>('settings-form');
const findBar = element('find-bar');
const findInput = element<HTMLInputElement>('find-input');
interface Tab { button: HTMLButtonElement; label: HTMLElement; wrapper: HTMLElement; panel: HTMLElement; view: TerminalView; cwd: string; shell: string; agent?: string; attention: boolean }
const tabs: Tab[] = [];
let active: Tab | undefined;
let preferences: Preferences;
let counter = 0;

let updateState: UpdateState | undefined;
let upToDate = false;
let upToDateTimer: ReturnType<typeof setTimeout> | undefined;
function renderUpdate(state: UpdateState): void {
  updateState = state;
  element('app-updates').dataset.status = state.status;
  element('app-version').textContent = `v${state.version}`;
  const status = element('update-status');
  const button = element<HTMLButtonElement>('update-button');
  const busy = ['confirming', 'downloading', 'installing'].includes(state.status);
  const labels: Partial<Record<UpdateState['status'], string>> = {
    checking: 'Checking for updates…', available: `Version ${state.latestVersion} available`,
    confirming: 'Waiting for confirmation…', downloading: 'Downloading update…', installing: 'Installing and restarting…',
    error: state.message || 'Update failed. Try again.',
  };
  status.textContent = labels[state.status] || '';
  // Only a manual check confirms "up to date"; any later state change clears it.
  if (state.status !== 'idle') {
    upToDate = false;
    clearTimeout(upToDateTimer);
  }
  else if (upToDate) status.textContent = 'Y-Term is up to date';
  status.hidden = !status.textContent;
  button.hidden = !busy && state.status !== 'available' && state.status !== 'error';
  button.disabled = busy;
  const check = element<HTMLButtonElement>('update-check');
  check.hidden = state.status === 'disabled';
  check.disabled = busy || state.status === 'checking';
  button.textContent = state.status === 'error' ? (state.latestVersion ? 'Retry update' : 'Retry check') :
    busy ? (state.status === 'confirming' ? 'Update' : 'Updating…') : 'Update';
}
window.terminal.onUpdateState(renderUpdate);
// Subscribe first, then ignore an initial snapshot if a newer event arrived.
void window.terminal.getUpdateState().then(state => { if (!updateState) renderUpdate(state); }).catch(report);
element<HTMLButtonElement>('update-check').onclick = () => {
  if (!updateState) return;
  element<HTMLButtonElement>('update-check').disabled = true;
  // Use the returned state: the reply may arrive before or after the state events.
  void window.terminal.checkForUpdates().then(state => {
    clearTimeout(upToDateTimer);
    upToDate = state.status === 'idle';
    renderUpdate(state);
    if (upToDate) {
      upToDateTimer = setTimeout(() => {
        upToDate = false;
        if (updateState) renderUpdate(updateState);
      }, 5000);
    }
  }, () => {
    if (updateState) renderUpdate({ ...updateState, status: 'error', message: 'Could not check for updates.' });
  });
};
element<HTMLButtonElement>('update-button').onclick = () => {
  if (!updateState) return;
  element<HTMLButtonElement>('update-button').disabled = true;
  const request = updateState.latestVersion ? window.terminal.installUpdate() : window.terminal.checkForUpdates();
  void request.catch(() => {
    if (updateState) renderUpdate({ ...updateState, status: 'error', message: 'Update request failed. Try again.' });
  });
};

function report(value: unknown): void { message.textContent = String(value); }
function directoryName(cwd: string): string { return cwd.split('/').filter(Boolean).pop() || '/'; }
function groupTabs(): void {
  const groups = new Map<string, Tab[]>();
  for (const tab of tabs) {
    const name = directoryName(tab.cwd);
    const group = groups.get(name);
    if (group) group.push(tab);
    else groups.set(name, [tab]);
  }
  tabs.splice(0, tabs.length, ...[...groups.values()].flat());
  tabs.forEach((tab, index) => {
    const current = tablist.children[index];
    if (current !== tab.wrapper) tablist.insertBefore(tab.wrapper, current || null);
  });
  publishLayout();
}
function updateHeader(): void {
  element('active-title').textContent = active?.label.textContent || 'Y-Term';
  element('active-directory').textContent = active?.cwd || '';
  element('active-shell').textContent = active ? `${active.agent ?? active.shell} · Local` : 'Local';
  element('session-count').textContent = String(tabs.length);
  element('empty-state').hidden = tabs.length > 0;
}
function publishAttention(): void { window.terminal.setAttentionCount(tabs.filter(tab => tab.attention).length); }
// Main keeps the sidebar order so an update restart can reopen the same tabs.
function publishLayout(): void {
  window.terminal.setLayout(tabs.flatMap(tab => tab.view.sessionId ?? []), active?.view.sessionId);
}
function needsAttention(tab: Tab, signal: AttentionSignal): void {
  // The user is already looking at it; repeated signals collapse until it is seen.
  if ((tab === active && document.hasFocus()) || tab.attention) return;
  tab.attention = true;
  tab.wrapper.dataset.attention = 'true';
  tab.button.setAttribute('aria-description', 'Needs attention');
  publishAttention();
  window.terminal.notifyAttention(tab.button.id, signal.title || tab.label.textContent || 'Y-Term', signal.body || `Needs your attention in ${directoryName(tab.cwd)}`);
}
function clearAttention(tab: Tab): void {
  if (!tab.attention) return;
  tab.attention = false;
  delete tab.wrapper.dataset.attention;
  tab.button.removeAttribute('aria-description');
  publishAttention();
}
function select(tab: Tab): void {
  active = tab;
  clearAttention(tab);
  for (const item of tabs) {
    const selected = item === tab;
    item.button.setAttribute('aria-selected', String(selected));
    item.button.tabIndex = selected ? 0 : -1;
    item.panel.hidden = !selected;
  }
  updateHeader();
  publishLayout();
  tab.button.scrollIntoView({ block: 'nearest' });
  tab.view.focus();
}
async function newTab(restore?: RestoredTab): Promise<Tab | undefined> {
  if (tabs.length >= 32) { report('Close a tab before opening another (maximum 32 tabs).'); return; }
  // A restored tab starts in its saved directory instead of the active tab's.
  const sourceId = restore ? undefined : active?.view.sessionId;
  const n = ++counter;
  const wrapper = document.createElement('div'); wrapper.className = 'tab'; wrapper.setAttribute('role', 'presentation');
  const button = document.createElement('button'); button.setAttribute('role', 'tab'); button.id = `tab-${n}`;
  const label = document.createElement('span'); label.className = 'tab-label'; label.textContent = `Shell ${n}`;
  const directory = document.createElement('span'); directory.className = 'tab-directory';
  const initialCwd = restore ? restore.cwd ?? preferences.cwd : active?.cwd || preferences.cwd;
  directory.textContent = directoryName(initialCwd);
  const text = document.createElement('span'); text.className = 'tab-text'; text.append(label, directory);
  button.append(element<HTMLTemplateElement>('session-icon').content.cloneNode(true), text);
  const close = document.createElement('button'); close.className = 'tab-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Close tab');
  const indicator = document.createElement('span'); indicator.className = 'tab-attention'; indicator.setAttribute('aria-hidden', 'true');
  const panel = document.createElement('section'); panel.className = 'terminal-panel'; panel.id = `panel-${n}`;
  panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id); button.setAttribute('aria-controls', panel.id);
  const status = document.createElement('div'); status.className = 'session-status'; status.hidden = true; status.setAttribute('role', 'status');
  const restart = document.createElement('button'); restart.textContent = 'New shell'; restart.onclick = () => { void newTab(); };
  const statusText = document.createElement('span'); status.append(statusText, restart);
  const host = document.createElement('div'); host.className = 'terminal-host'; panel.append(status, host);
  wrapper.append(button, indicator, close); tablist.append(wrapper); panels.append(panel);
  const view = new TerminalView(host, preferences, title => {
    label.textContent = title || `Shell ${n}`;
    button.title = label.textContent;
    if (active?.button === button) updateHeader();
  }, value => {
    statusText.textContent = value; status.hidden = false;
  }, cwd => {
    tab.cwd = cwd;
    directory.textContent = directoryName(cwd);
    groupTabs();
    if (active === tab) updateHeader();
  }, agent => {
    tab.agent = agent;
    const icon = element<HTMLTemplateElement>(agent ? 'agent-icon' : 'session-icon').content.cloneNode(true) as DocumentFragment;
    if (agent) icon.querySelector('svg')?.setAttribute('aria-label', `${agent} running`);
    button.querySelector('svg')?.replaceWith(icon);
    if (agent) wrapper.dataset.agent = agent;
    else delete wrapper.dataset.agent;
    if (active === tab) updateHeader();
  }, signal => needsAttention(tab, signal));
  const tab: Tab = { button, label, wrapper, panel, view, cwd: initialCwd, shell: preferences.shell.split('/').pop() || preferences.shell, attention: false }; tabs.push(tab);
  groupTabs();
  view.terminal.onData(() => clearAttention(tab));
  button.onclick = () => select(tab);
  close.onclick = () => closeTab(tab);
  button.onkeydown = event => {
    if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); cycle(event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1); active?.button.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); select(tabs[event.key === 'Home' ? 0 : tabs.length - 1]); active?.button.focus();
    }
  };
  select(tab);
  try {
    await view.start(sourceId, restore?.cwd);
    publishLayout();
    // The shell holds typed input until its prompt is ready.
    if (restore?.resume && view.sessionId) window.terminal.write(view.sessionId, `${resumeCommand(restore.resume)}\r`);
  }
  catch (error) { if (tabs.includes(tab)) { statusText.textContent = String(error); status.hidden = false; } }
  return tab;
}
function closeTab(tab = active): void {
  if (!tab) return;
  const index = tabs.indexOf(tab); if (index === -1) return;
  tabs.splice(index, 1); tab.wrapper.remove(); tab.panel.remove();
  if (tab.attention) publishAttention();
  void tab.view.close().catch(report);
  publishLayout();
  if (active === tab) {
    active = undefined;
    const next = tabs[Math.min(index, tabs.length - 1)];
    if (next) select(next);
    else {
      report('No open shells. Press ⌘T to start a new session.');
      element('empty-state').hidden = false;
      element('empty-new-tab').focus();
    }
  }
  updateHeader();
}
function cycle(direction: number): void {
  if (active && tabs.length) select(tabs[(tabs.indexOf(active) + direction + tabs.length) % tabs.length]);
}
function applyPreferences(): void {
  document.documentElement.dataset.theme = preferences.theme;
  for (const tab of tabs) { tab.view.apply(preferences); tab.view.fit(); }
}
function openSettings(): void {
  for (const [key, value] of Object.entries(preferences)) {
    const input = settingsForm.elements.namedItem(key);
    if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) input.value = String(value);
  }
  element('settings-error').textContent = '';
  if (!settings.open) settings.showModal();
}
function find(backwards = false): void {
  const query = findInput.value;
  const found = active && query && (backwards ? active.view.search.findPrevious(query) : active.view.search.findNext(query));
  element('find-status').textContent = query && !found ? 'No match' : '';
}
function toggleSidebar(): void {
  const sidebar = element('sidebar');
  // Hiding a focused tab button would strand keyboard focus on an invisible element.
  const refocus = sidebar.contains(document.activeElement);
  sidebar.hidden = !sidebar.hidden;
  if (refocus) active?.view.focus();
}
function action(command: MenuAction): void {
  // App menus can fire while a modal owns focus; keep actions inside the dialog.
  if (document.querySelector('dialog[open]')) return;
  if (command === 'new-tab') void newTab().catch(report);
  else if (command === 'toggle-sidebar') toggleSidebar();
  else if (command === 'close-tab') closeTab();
  else if (command === 'settings') openSettings();
  else if (command === 'next-tab') cycle(1);
  else if (command === 'previous-tab') cycle(-1);
  else if (command === 'clear') active?.view.terminal.clear();
  else if (command === 'find') {
    findBar.hidden = false; findInput.focus(); findInput.select();
  }
  else if (command.startsWith('zoom-')) {
    const fontSize = command === 'zoom-reset' ? 14 : Math.max(9, Math.min(36, preferences.fontSize + (command === 'zoom-in' ? 1 : -1)));
    void window.terminal.savePreferences({ ...preferences, fontSize }).then(saved => { preferences = saved; applyPreferences(); }).catch(report);
  }
}
element('new-tab').onclick = () => { void newTab().catch(report); };
element('empty-new-tab').onclick = () => { void newTab().catch(report); };
element('settings-open').onclick = openSettings;
element('settings-cancel').onclick = () => settings.close();
settings.addEventListener('close', () => active?.view.focus());
settingsForm.onsubmit = event => {
  event.preventDefault();
  const values = new FormData(settingsForm);
  const value = { ...preferences, ...Object.fromEntries(values), fontSize: Number(values.get('fontSize')), scrollback: Number(values.get('scrollback')) } as Preferences;
  void window.terminal.savePreferences(value).then(saved => {
    preferences = saved; applyPreferences(); settings.close(); report('Settings saved. New tabs use the configured shell and directory.');
  }).catch(error => { element('settings-error').textContent = String(error); });
};
findInput.oninput = () => find();
findInput.onkeydown = event => {
  if (event.key === 'Enter') { event.preventDefault(); find(event.shiftKey); }
  if (event.key === 'Escape') { event.preventDefault(); findBar.hidden = true; active?.view.focus(); }
};
element('find-next').onclick = () => find();
element('find-previous').onclick = () => find(true);
element('find-close').onclick = () => { findBar.hidden = true; active?.view.focus(); };
window.terminal.onAction(action);
window.terminal.onAttentionActivate(id => {
  const tab = tabs.find(item => item.button.id === id);
  if (tab && !document.querySelector('dialog[open]')) select(tab);
});
window.addEventListener('focus', () => { if (active) clearAttention(active); });
window.addEventListener('beforeunload', () => {
  for (const tab of tabs) void tab.view.close();
  window.terminal.setAttentionCount(0);
});
async function restoreTabs(): Promise<void> {
  const restored = await window.terminal.takeRestoredTabs();
  if (!restored?.tabs.length) { await newTab(); return; }
  const opened: (Tab | undefined)[] = [];
  for (const tab of restored.tabs) opened.push(await newTab(tab));
  const selected = opened[restored.active] ?? opened.findLast(Boolean);
  if (selected && tabs.includes(selected)) select(selected);
  const agents = [...new Set(restored.tabs.flatMap(tab => tab.resume ? AGENT_LABELS[tab.resume.agent] : []))];
  report(`Reopened ${restored.tabs.length} ${restored.tabs.length === 1 ? 'tab' : 'tabs'} after updating${agents.length ? ` and resumed ${agents.join(' and ')} sessions` : ''}.`);
}
void window.terminal.getPreferences().then(value => {
  preferences = value;
  attachSidebarResize(element('sidebar'), element('sidebar-resize'), preferences.sidebarWidth, width => {
    preferences.sidebarWidth = width;
    void window.terminal.savePreferences({ ...preferences }).catch(report);
  });
  applyPreferences();
  return restoreTabs();
}).catch(report);
