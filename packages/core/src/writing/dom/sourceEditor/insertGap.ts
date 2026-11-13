// The insert strip of the source editor, as the notes editor has it (qmd/dom/insertGap.ts): between two blocks, a '——— + ———' that shows while the pointer is on
// the gap and opens a menu of what fits there (a comment on the block above, the blank-line insertions). It is drawn on a layer, so the text never moves.
import { StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { EditorView, ViewPlugin, layer, type LayerMarker } from "@codemirror/view";
import { deriveInsertGaps, type InsertGap, type TypingLanguage } from "../../../index.js";
import { renderIcon } from "../../../ui/icons/index.js";
import { showMenu, type MenuEntry } from "../../../ui/dom/index.js";

/** How far, in pixels, from the edge between two lines the pointer still counts as on a gap that has no blank line. */
const EDGE_BAND = 5;

/** The menu of the gap after the 1-based `line`; empty hides the strip there. */
export type InsertGapEntries = (view: EditorView, line: number) => MenuEntry[];

const setHovered = StateEffect.define<number | null>();
/** The line whose gap is shown: hovered, or the one whose menu is open. */
const hoveredField = StateField.define<number | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setHovered)) return effect.value;
    return transaction.docChanged ? null : value;
  },
});

/** The gaps of a document, kept until it changes. */
function gapsOf(language: TypingLanguage): (doc: Text) => ReadonlyMap<number, InsertGap> {
  let cached: { doc: Text; gaps: ReadonlyMap<number, InsertGap> } | undefined;
  return (doc) => {
    if (cached?.doc !== doc) cached = { doc, gaps: new Map(deriveInsertGaps(language, doc.toString()).map((gap) => [gap.line, gap])) };
    return cached.gaps;
  };
}

/** The gap under the pointer: a blank line holding one, or the edge under a line that has one. */
function gapAtHeight(view: EditorView, gaps: ReadonlyMap<number, InsertGap>, clientY: number): number | null {
  const y = clientY - view.documentTop;
  if (y < 0 || y > view.contentHeight) return null;
  const block = view.lineBlockAtHeight(y);
  const { doc } = view.state;
  const line = doc.lineAt(block.from).number;
  const above = gaps.get(line - 1);
  if (above?.blank && doc.line(line).text.trim() === "") return line - 1;
  const own = gaps.get(line);
  if (own && !own.blank && y >= block.bottom - EDGE_BAND) return line;
  if (above && !above.blank && y <= block.top + EDGE_BAND) return line - 1;
  return null;
}

class GapMarker implements LayerMarker {
  constructor(
    readonly line: number, readonly left: number, readonly top: number, readonly width: number,
    private readonly open: (anchor: HTMLElement, line: number) => void,
  ) {}

  eq(other: LayerMarker): boolean {
    return other instanceof GapMarker && other.line === this.line && other.left === this.left && other.top === this.top && other.width === this.width;
  }

  draw(): HTMLElement {
    const strip = document.createElement("div");
    strip.className = "ls-insert-gap";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ls-insert-gap-plus";
    button.title = "Comment or insert here";
    button.innerHTML = renderIcon("plus");
    // The editor keeps the focus and its selection; the menu takes the focus when it opens.
    button.addEventListener("mousedown", (event) => { event.preventDefault(); event.stopPropagation(); });
    button.addEventListener("click", () => this.open(button, this.line));
    strip.append(button);
    this.place(strip);
    return strip;
  }

  update(dom: HTMLElement, old: LayerMarker): boolean {
    if (!(old instanceof GapMarker) || old.line !== this.line) return false;
    this.place(dom);
    return true;
  }

  private place(dom: HTMLElement): void {
    Object.assign(dom.style, { left: `${this.left}px`, top: `${this.top}px`, width: `${this.width}px` });
  }
}

/** The strip of one editor; `entries` builds its menu, so the popup's settings and host actions decide what it offers. */
export function createInsertGap(language: TypingLanguage, entries: InsertGapEntries): Extension {
  const gaps = gapsOf(language);
  let menuOpen = false;
  const show = (view: EditorView, line: number | null): void => {
    if (view.state.field(hoveredField) !== line) view.dispatch({ effects: setHovered.of(line) });
  };
  const open = (view: EditorView) => (anchor: HTMLElement, line: number): void => {
    const items = entries(view, line);
    if (items.length === 0) return;
    menuOpen = true;
    showMenu(anchor, items, { onClose: () => { menuOpen = false; show(view, null); } });
  };

  const tracker = ViewPlugin.define((view) => {
    const move = (event: MouseEvent): void => {
      if (menuOpen) return;
      // A drag is a selection; the strip stays while the pointer is on it, though its button reaches past the gap's band.
      if (event.buttons !== 0) { show(view, null); return; }
      if (event.target instanceof Element && event.target.closest(".ls-insert-gap")) return;
      const line = gapAtHeight(view, gaps(view.state.doc), event.clientY);
      show(view, line !== null && entries(view, line).length > 0 ? line : null);
    };
    const leave = (event: MouseEvent): void => { if (!menuOpen && !(event.relatedTarget instanceof Node && view.scrollDOM.contains(event.relatedTarget))) show(view, null); };
    view.scrollDOM.addEventListener("mousemove", move);
    view.scrollDOM.addEventListener("mouseleave", leave);
    return { destroy() { view.scrollDOM.removeEventListener("mousemove", move); view.scrollDOM.removeEventListener("mouseleave", leave); } };
  });

  const strip = layer({
    above: true,
    class: "ls-insert-gap-layer",
    update: (update) => update.startState.field(hoveredField) !== update.state.field(hoveredField) || update.viewportChanged,
    markers(view) {
      const line = view.state.field(hoveredField);
      if (line === null || line > view.state.doc.lines) return [];
      const gap = gaps(view.state.doc).get(line);
      if (!gap) return [];
      const { doc } = view.state;
      const edge = gap.blank ? view.lineBlockAt(doc.line(line + 1).from) : view.lineBlockAt(doc.line(line).from);
      const middle = gap.blank ? (edge.top + edge.bottom) / 2 : edge.bottom;
      const scroller = view.scrollDOM.getBoundingClientRect();
      const content = view.contentDOM.getBoundingClientRect();
      const left = content.left - scroller.left + view.scrollDOM.scrollLeft;
      const top = view.documentTop - scroller.top + view.scrollDOM.scrollTop + middle;
      return [new GapMarker(line, left, top, view.contentDOM.clientWidth, open(view))];
    },
  });

  const theme = EditorView.theme({
    // The layer itself is aria-hidden and has no size; only the strip takes the pointer.
    ".ls-insert-gap-layer": { pointerEvents: "none" },
    ".ls-insert-gap": {
      display: "flex", alignItems: "center", gap: "var(--ls-space-4)", boxSizing: "border-box", height: "0", padding: "0 var(--ls-space-8)",
      color: "var(--ls-desc)", pointerEvents: "none",
    },
    ".ls-insert-gap::before, .ls-insert-gap::after": { content: '""', flex: "1", height: "1px", background: "var(--ls-border-soft)" },
    ".ls-insert-gap-plus": {
      display: "flex", alignItems: "center", justifyContent: "center", width: "18px", height: "18px", padding: "0", border: "none", borderRadius: "50%",
      background: "var(--ls-bg)", color: "inherit", cursor: "pointer", pointerEvents: "auto",
    },
    ".ls-insert-gap-plus:hover, .ls-insert-gap-plus:focus-visible": { color: "var(--ls-fg)", background: "var(--ls-toolbar-hover)", outline: "none" },
    ".ls-insert-gap-plus svg": { width: "var(--ls-text-md)", height: "var(--ls-text-md)" },
  });

  return [hoveredField, tracker, strip, theme];
}
