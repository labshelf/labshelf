// Computes which rows of a fixed-height flat list are rendered for a viewport, with spacer heights around them.
// Folder headers count as rows, and a collapsed folder's rows are simply absent from the count.
export interface RowViewport {
  scrollTop: number;
  height: number;
}

/** Rows `start` (inclusive) to `end` (exclusive) render; `padTop`/`padBottom` are the spacer heights in px. */
export interface RowSlice {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
}

export interface RowWindow {
  slice(rows: number, viewport: RowViewport): RowSlice;
  indexAt(scrollTop: number): number;
  scrollTopFor(index: number, viewport: RowViewport): number;
}

export function createRowWindow({ rowHeight, overscan = 10 }: { rowHeight: number; overscan?: number }): RowWindow {
  if (!(rowHeight > 0)) throw new Error(`Row window needs a positive row height, got ${rowHeight}`);
  const indexAt = (scrollTop: number): number => Math.floor(Math.max(0, scrollTop) / rowHeight);
  return {
    indexAt,
    slice(rows, { scrollTop, height }) {
      // A collapse can leave scrollTop past the shorter list's end; clamp so the slice is never empty.
      const top = Math.min(scrollTop, Math.max(0, rows * rowHeight - height));
      const start = Math.max(0, indexAt(top) - overscan);
      const end = Math.min(rows, Math.ceil((top + height) / rowHeight) + overscan);
      return { start, end: Math.max(start, end), padTop: start * rowHeight, padBottom: Math.max(0, rows - end) * rowHeight };
    },
    scrollTopFor(index, { scrollTop, height }) {
      const rowTop = index * rowHeight;
      if (rowTop < scrollTop) return rowTop;
      if (rowTop + rowHeight > scrollTop + height) return rowTop + rowHeight - height;
      return scrollTop;
    },
  };
}
