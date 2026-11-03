export type ShellMark =
  | { kind: 'prompt' }
  | { kind: 'input' }
  | { kind: 'output' }
  | { kind: 'finished'; exitCode?: number };

/** OSC 133 semantic prompt marks: A prompt, B input, C output, D[;exit code]. */
export function parseOsc133(data: string): ShellMark | undefined {
  if (data === 'A') return { kind: 'prompt' };
  if (data === 'B') return { kind: 'input' };
  if (data === 'C') return { kind: 'output' };
  if (data === 'D') return { kind: 'finished' };
  const code = /^D;(\d+)$/.exec(data);
  return code ? { kind: 'finished', exitCode: Number(code[1]) } : undefined;
}

/** OSC 633 E;<escaped command>;<nonce>. The nonce keeps program output from forging commands. */
export function parseCommandLine(data: string, nonce: string | undefined): string | undefined {
  if (!nonce || !data.startsWith('E;')) return undefined;
  const end = data.lastIndexOf(';');
  if (end < 2 || data.slice(end + 1) !== nonce) return undefined;
  return data.slice(2, end).replace(/\\(\\|x[0-9a-fA-F]{2})/g, (_, esc: string) =>
    esc === '\\' ? '\\' : String.fromCharCode(parseInt(esc.slice(1), 16)));
}
