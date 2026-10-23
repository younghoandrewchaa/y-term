export function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8192) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
  } catch { return false; }
}

export function isTrustedFrame(actual: string | undefined, expected: string, mainFrame: boolean): boolean {
  return mainFrame && actual === expected;
}
