/** Quote native macOS paths as literal Unix shell arguments. */
export function formatDroppedPaths(paths: readonly string[]): string {
  for (const path of paths) {
    if (!path.startsWith('/') || /[\x00-\x1f\x7f]/.test(path)) {
      throw new Error('Cannot insert this selection: paths must be absolute and contain no control characters.');
    }
  }
  return paths.length ? paths.map(path => `'${path.replaceAll("'", "'\\''")}'`).join(' ') + ' ' : '';
}

export interface FileDropCallbacks {
  canPaste(): boolean;
  getPathForFile(file: File): string;
  paste(text: string): void;
  focus(): void;
  report(message: string): void;
}

/** Capture native drops before xterm's own drag handlers can consume them. */
export function attachTerminalFileDrop(host: HTMLElement, callbacks: FileDropCallbacks): () => void {
  const dragover = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.dataTransfer.dropEffect = callbacks.canPaste() ? 'copy' : 'none';
  };
  const drop = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!callbacks.canPaste()) return;
    try {
      const paths = Array.from(event.dataTransfer.files, file => callbacks.getPathForFile(file));
      const text = formatDroppedPaths(paths);
      if (!text || !callbacks.canPaste()) return;
      callbacks.paste(text);
      callbacks.focus();
    } catch {
      callbacks.report('Cannot insert this selection: use local files or folders whose paths contain no control characters.');
    }
  };
  host.addEventListener('dragover', dragover, { capture: true });
  host.addEventListener('drop', drop, { capture: true });
  return () => {
    host.removeEventListener('dragover', dragover, { capture: true });
    host.removeEventListener('drop', drop, { capture: true });
  };
}
