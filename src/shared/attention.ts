export interface AttentionSignal { title?: string; body?: string }

/** Terminal output is untrusted: keep notification text short and printable. */
export function notificationText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || fallback;
}

/** iTerm2 notifications. ConEmu reuses OSC 9 for numbered subcommands such as 9;4 progress. */
export function parseOsc9(data: string): AttentionSignal | undefined {
  if (/^\d+(;|$)/.test(data)) return undefined;
  return { body: data };
}

/** rxvt-unicode notifications: notify;title;body. */
export function parseOsc777(data: string): AttentionSignal | undefined {
  const [kind, title, ...body] = data.split(';');
  if (kind !== 'notify') return undefined;
  return { title, body: body.join(';') };
}
