/** OSC 7 paths are terminal-supplied display text, never local filesystem paths. */
export function remoteDirectory(report: string): { host: string; path: string } | undefined {
  if (report.length > 4096) return undefined;
  const match = /^file:\/\/([^/?#]*)(\/[^?#]*)$/.exec(report);
  if (!match) return undefined;
  try {
    const path = decodeURIComponent(match[2]);
    if (/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(path)) return undefined;
    return { host: match[1], path };
  } catch { return undefined; }
}
