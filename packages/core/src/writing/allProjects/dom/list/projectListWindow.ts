// Renders only the treegrid rows near the viewport, re-slicing on scroll and resize, with padding standing in for the rest.
import { RowReconciler, createRowWindow, readRowHeight, type RowSlice, type RowViewport, type RowWindow } from "../../../../libraryUi/dom/list/index.js";
import type { FocusKeeper } from "./projectListFocus.js";

export interface WindowParts<T> {
  build: (item: T) => HTMLElement;
  /** The values a row renders from; a row is rebuilt when any of them changes identity. */
  inputs: (item: T) => readonly unknown[];
  /** Paints a rendered row's state; `index` is its place in the whole list. */
  decorate: (item: T, node: HTMLElement, index: number) => void;
  focus: FocusKeeper;
}

export interface WindowedRows<T> {
  update(items: readonly T[], empty: HTMLElement | null): void;
  /** Scrolls the row at `index` into view and returns its node, or null past the end. */
  reveal(index: number): HTMLElement | null;
  /** How many rows fit the viewport, or null when the list has no layout. */
  viewportRows(): number | null;
}

function keyedRows<T extends { id: string }>(body: HTMLElement, parts: WindowParts<T>): RowReconciler<T> {
  return new RowReconciler<T>(body, (item) => {
    const node = parts.build(item);
    node.dataset["key"] = item.id;
    return node;
  }, parts.inputs);
}

/** Repaints at most once per animation frame while the list scrolls. */
function repaintOnScroll(list: HTMLElement, paint: () => void): void {
  let pending = 0;
  list.addEventListener("scroll", () => {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = 0; paint(); });
  }, { passive: true });
}

/** `heads` is the sticky column-heads row, which covers the top of the scroll viewport. */
export function createWindowedRows<T extends { id: string }>(list: HTMLElement, body: HTMLElement, heads: HTMLElement, parts: WindowParts<T>): WindowedRows<T> {
  const rows = keyedRows(body, parts);
  let items: readonly T[] = [];
  let empty: HTMLElement | null = null;
  let nodes = new Map<string, HTMLElement>();
  let win: RowWindow | null = null;
  // A list without layout (hidden, or jsdom) has no viewport, so every row renders.
  const viewport = (): RowViewport | null => {
    const height = list.clientHeight - heads.offsetHeight;
    if (!(height > 0)) return null;
    win ??= createRowWindow({ rowHeight: readRowHeight(list) });
    return { scrollTop: list.scrollTop, height };
  };
  const sliceOf = (v: RowViewport | null): RowSlice =>
    v && win ? win.slice(items.length, v) : { start: 0, end: items.length, padTop: 0, padBottom: 0 };
  const paint = (): void => parts.focus.around(() => {
    const s = sliceOf(viewport());
    body.style.paddingTop = `${s.padTop}px`;
    body.style.paddingBottom = `${s.padBottom}px`;
    const shown = items.slice(s.start, s.end);
    rows.update(shown, empty);
    nodes = new Map(shown.map((item, i) => [item.id, body.children[i] as HTMLElement]));
    shown.forEach((item, i) => parts.decorate(item, nodes.get(item.id)!, s.start + i));
  }, (key) => nodes.get(key));
  repaintOnScroll(list, paint);
  // ResizeObserver is absent where the list renders without layout (jsdom); a resize can change the row height token too.
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => { win = null; paint(); }).observe(list);
  return {
    update(next, nextEmpty) {
      items = next;
      empty = nextEmpty;
      paint();
    },
    viewportRows() {
      const v = viewport();
      return v && win ? win.indexAt(v.height) : null;
    },
    reveal(index) {
      const item = items[index];
      if (!item) return null;
      const v = viewport();
      if (v && win) list.scrollTop = win.scrollTopFor(index, v);
      paint();
      return nodes.get(item.id) ?? null;
    },
  };
}
