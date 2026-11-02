export interface AgentReport {
  state: 'idle' | 'working' | 'done' | 'blocked' | 'error' | 'clear';
  id: string;
  app?: string;
}
export interface AgentStatusState { reported?: AgentReport; unseenCompletion: boolean }
export type AgentStatusEvent =
  | { type: 'report'; report: AgentReport; viewed: boolean }
  | { type: 'viewed' }
  | { type: 'reset' };

const STATES = new Set(['idle', 'working', 'done', 'blocked', 'error', 'clear']);
const NAME = /^[A-Za-z0-9_.+-]+$/;

/** OSC 7501 root/child report, bounded and validated before any state changes. */
export function parseAgentStatus(data: string): AgentReport | undefined {
  // The wire grammar is ASCII; 7 introducer bytes and 2 terminator bytes.
  if (data.length > 4087 || /[^\x09-\x0d\x20-\x7e]/.test(data)) return;
  const fields = new Map<string, string>();
  for (const pair of data.split(':')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key.length > 16) return;
    // An invalid child id must never fall back to the root, especially clear.
    if (key === 'id' && (value.length > 128 || value.split('/').length > 8
      || value.split('/').some(part => !NAME.test(part) || part.length > 32))) return;
    if (!/^[a-z]+$/.test(key) || !/^[A-Za-z0-9_.,+/=-]*$/.test(value)) continue;
    const limit = key === 'app' ? 32 : key === 'title' ? 256 : key === 'msg' ? 2732 : undefined;
    if (limit !== undefined && value.length > limit) return;
    fields.set(key, value);
  }
  for (const key of ['title', 'msg']) {
    const value = fields.get(key);
    if (!value) continue;
    try {
      const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
      if (bytes.length > (key === 'title' ? 192 : 2048)) return;
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (/[\x00-\x1f\x7f-\x9f]/.test(text)) return;
    } catch { return; }
  }
  const state = fields.get('state');
  if (!state || !STATES.has(state)) return;
  const app = fields.get('app');
  return { state: state as AgentReport['state'], id: fields.get('id') ?? '', ...(app && NAME.test(app) ? { app } : {}) };
}

export function reduceAgentStatus(state: AgentStatusState, event: AgentStatusEvent): AgentStatusState {
  if (event.type === 'reset') return { unseenCompletion: false };
  if (event.type === 'viewed') return { ...state, unseenCompletion: false };
  if (event.report.id) return state;
  const word = event.report.state;
  if (word === 'clear') return { unseenCompletion: false };
  const busy = state.reported?.state === 'working' || state.reported?.state === 'blocked' || state.reported?.state === 'error';
  const finished = word === 'idle' || word === 'done';
  const unseenCompletion = finished && (busy ? !event.viewed : state.unseenCompletion && !event.viewed);
  return { reported: event.report, unseenCompletion };
}

export function agentStatusLabel(state: AgentStatusState): 'Working' | 'Blocked' | 'Done' | 'Idle' | undefined {
  if (!state.reported) return;
  if (state.reported.state === 'working') return 'Working';
  if (state.reported.state === 'blocked' || state.reported.state === 'error') return 'Blocked';
  return state.unseenCompletion ? 'Done' : 'Idle';
}
