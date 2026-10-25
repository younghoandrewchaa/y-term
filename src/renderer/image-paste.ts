interface ImagePasteCallbacks {
  canPaste(): boolean;
  input(data: string): void;
}

/** Let the foreground terminal application read images from the native clipboard. */
export function attachTerminalImagePaste(host: HTMLElement, callbacks: ImagePasteCallbacks): () => void {
  const paste = (event: ClipboardEvent) => {
    if (!Array.from(event.clipboardData?.items ?? []).some(item => item.kind === 'file' && item.type.startsWith('image/'))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Send a key, not bracketed paste: Codex handles Ctrl+V by reading the
    // native clipboard and owns attachment numbering within its session.
    if (callbacks.canPaste()) callbacks.input('\x16');
  };
  host.addEventListener('paste', paste, { capture: true });
  return () => host.removeEventListener('paste', paste, { capture: true });
}
