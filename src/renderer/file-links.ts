import type { IBufferCellPosition, ILink, ILinkProvider, Terminal } from '@xterm/xterm';

/** Use cells rather than string columns: Unicode glyphs can occupy 0, 1 or 2 cells. */
export function createFileLinkProvider(terminal: Pick<Terminal, 'buffer' | 'cols'>,
  activate: (event: MouseEvent, path: string) => void): ILinkProvider {
  return {
    provideLinks(row, callback) {
      const buffer = terminal.buffer.active;
      let first = row - 1;
      const limit = 64;
      while (first > 0 && buffer.getLine(first)?.isWrapped && row - first < limit) first--;
      if (buffer.getLine(first)?.isWrapped) { callback(undefined); return; }
      let text = '';
      const starts: IBufferCellPosition[] = [];
      const ends: IBufferCellPosition[] = [];
      for (let y = first; y < first + limit; y++) {
        const line = buffer.getLine(y);
        if (!line) break;
        const next = buffer.getLine(y + 1);
        for (let x = 0; x < terminal.cols; x++) {
          const cell = line.getCell(x);
          if (!cell || cell.getWidth() === 0) continue;
          // A wide glyph can leave an unused final cell before a soft wrap.
          if (x === terminal.cols - 1 && !cell.getChars() && next?.isWrapped && next.getCell(0)?.getWidth() === 2) continue;
          const chars = cell.getChars() || ' ';
          text += chars;
          for (let i = 0; i < chars.length; i++) {
            starts.push({ x: x + 1, y: y + 1 });
            ends.push({ x: x + cell.getWidth(), y: y + 1 });
          }
        }
        if (!next?.isWrapped) break;
        if (y === first + limit - 1) { callback(undefined); return; }
      }
      const links: ILink[] = [];
      const tokens = /(?<![\p{L}\p{N}_])(?:"([^"\r\n]+)"|'([^'\r\n]+)'|`([^`\r\n]+)`)|[^\s"'`<>()\[\]{}]+/gu;
      for (const match of text.matchAll(tokens)) {
        const quoted = match[1] ?? match[2] ?? match[3];
        const raw = quoted ?? match[0];
        const leading = quoted === undefined ? raw.match(/^\*+/)?.[0].length ?? 0 : 0;
        const path = quoted ?? raw.slice(leading).replace(/[.,;:!?*]+$/, '');
        if (!path || (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^file:\/\//i.test(path) && !/^[^/:]+:\d+(?:[:-]\d+)?$/.test(path))) continue;
        if (!path.includes('/') && !/^[^\s/:]+\.[\p{L}\d][\p{L}\d._-]*(?::\d+(?:[:-]\d+)?)?$/u.test(path)) continue;
        const index = match.index + (quoted === undefined ? leading : 1);
        const start = starts[index];
        const end = ends[index + path.length - 1];
        if (!start || !end || row < start.y || row > end.y) continue;
        links.push({ text: path, range: { start, end }, activate: event => activate(event, path) });
      }
      callback(links);
    },
  };
}
