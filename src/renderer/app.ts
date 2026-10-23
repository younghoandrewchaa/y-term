import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { TerminalView } from './terminal-view.ts';
import type { MenuAction, Preferences } from '../shared/terminal-protocol.ts';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tablist = element('tabs');
const panels = element('panels');
const message = element('message');
const settings = element<HTMLDialogElement>('settings');
const settingsForm = element<HTMLFormElement>('settings-form');
const findBar = element('find-bar');
const findInput = element<HTMLInputElement>('find-input');
interface Tab { button: HTMLButtonElement; wrapper: HTMLElement; panel: HTMLElement; view: TerminalView }
const tabs: Tab[] = [];
let active: Tab | undefined;
let preferences: Preferences;
let counter = 0;

function report(value: unknown): void { message.textContent = String(value); }
function select(tab: Tab): void {
  active = tab;
  for (const item of tabs) {
    const selected = item === tab;
    item.button.setAttribute('aria-selected', String(selected));
    item.button.tabIndex = selected ? 0 : -1;
    item.panel.hidden = !selected;
  }
  tab.view.focus();
}
async function confirmPaste(text: string): Promise<boolean> {
  const dialog = element<HTMLDialogElement>('paste-dialog');
  if (dialog.open) return false;
  element('paste-preview').textContent = text.slice(0, 4000);
  dialog.returnValue = 'cancel';
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'paste'), { once: true }));
}
async function newTab(): Promise<void> {
  if (tabs.length >= 32) { report('Close a tab before opening another (maximum 32 tabs).'); return; }
  const n = ++counter;
  const wrapper = document.createElement('div'); wrapper.className = 'tab'; wrapper.setAttribute('role', 'presentation');
  const button = document.createElement('button'); button.setAttribute('role', 'tab'); button.id = `tab-${n}`;
  button.textContent = `Shell ${n}`;
  const close = document.createElement('button'); close.className = 'tab-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Close tab');
  const panel = document.createElement('section'); panel.className = 'terminal-panel'; panel.id = `panel-${n}`;
  panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id); button.setAttribute('aria-controls', panel.id);
  const status = document.createElement('div'); status.className = 'session-status'; status.hidden = true; status.setAttribute('role', 'status');
  const restart = document.createElement('button'); restart.textContent = 'New shell'; restart.onclick = () => { void newTab(); };
  const statusText = document.createElement('span'); status.append(statusText, restart);
  const host = document.createElement('div'); host.className = 'terminal-host'; panel.append(status, host);
  wrapper.append(button, close); tablist.append(wrapper); panels.append(panel);
  const view = new TerminalView(host, preferences, title => { button.textContent = title || `Shell ${n}`; }, value => {
    statusText.textContent = value; status.hidden = false;
  }, confirmPaste);
  const tab = { button, wrapper, panel, view }; tabs.push(tab);
  button.onclick = () => select(tab);
  close.onclick = () => closeTab(tab);
  button.onkeydown = event => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault(); cycle(event.key === 'ArrowRight' ? 1 : -1); active?.button.focus();
    }
  };
  select(tab);
  try { await view.start(); }
  catch (error) { if (tabs.includes(tab)) { statusText.textContent = String(error); status.hidden = false; } }
}
function closeTab(tab = active): void {
  if (!tab) return;
  const index = tabs.indexOf(tab); if (index === -1) return;
  tabs.splice(index, 1); tab.wrapper.remove(); tab.panel.remove();
  void tab.view.close().catch(report);
  if (active === tab) {
    active = undefined;
    const next = tabs[Math.min(index, tabs.length - 1)];
    if (next) select(next);
    else report('No open shells. Press ⌘T or + to start a new tab.');
  }
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
function action(command: MenuAction): void {
  // App menus can fire while a modal owns focus; keep actions inside the dialog.
  if (document.querySelector('dialog[open]')) return;
  if (command === 'new-tab') void newTab().catch(report);
  else if (command === 'close-tab') closeTab();
  else if (command === 'settings') openSettings();
  else if (command === 'next-tab') cycle(1);
  else if (command === 'previous-tab') cycle(-1);
  else if (command === 'clear') active?.view.terminal.clear();
  else if (command === 'find') { findBar.hidden = false; findInput.focus(); findInput.select(); }
  else if (command.startsWith('zoom-')) {
    const fontSize = command === 'zoom-reset' ? 14 : Math.max(9, Math.min(36, preferences.fontSize + (command === 'zoom-in' ? 1 : -1)));
    void window.terminal.savePreferences({ ...preferences, fontSize }).then(saved => { preferences = saved; applyPreferences(); }).catch(report);
  }
}
element('new-tab').onclick = () => { void newTab().catch(report); };
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
window.addEventListener('beforeunload', () => { for (const tab of tabs) void tab.view.close(); });
void window.terminal.getPreferences().then(value => { preferences = value; applyPreferences(); return newTab(); }).catch(report);
