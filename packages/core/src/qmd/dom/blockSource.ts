// The current text block as source (plan advanced-notes D16): with the Advanced switch on, a text block (paragraph, heading, list, table or a Quarto
// block kept raw) that takes the caret shows its Markdown, LaTeX and Quarto source in a plain editor in its place; leaving it shows it rendered again.
// Edits are read back into blocks as they are typed (300 ms), so the note saves them like any edit and undo restores them.
import type { Node as ProseNode } from "prosemirror-model";
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { createDebouncer } from "../../async/index.js";
import { renderElement } from "../../ui/dom/index.js";
import { bodyToDoc, docToBody, qmdSchema } from "../editor/index.js";
import { foldStateOf } from "./foldPlugin.js";

/** The top-level blocks shown as source while the caret is in them. */
const SOURCE_BLOCKS: ReadonlySet<string> = new Set(["paragraph", "heading", "bullet_list", "ordered_list", "table", "raw_block", "math_display"]);

/** The range of top-level blocks shown as source, or null. */
type Range = { from: number; to: number } | null;
const key = new PluginKey<Range>("qmdBlockSource");

/** The Markdown of the top-level `node` alone, in the note's line ends, without the line end after its last line. */
function sourceOf(state: EditorState, node: ProseNode): string {
  const eol = state.doc.attrs.eol as string;
  return docToBody(qmdSchema.nodes.doc!.create({ eol, trailing: "", unterminated: false }, [node.type.create({ ...node.attrs, gap: null }, node.content, node.marks)])).replace(/\r?\n$/, "");
}

/**
 * Where in `source` the caret goes for the caret `offset` characters into the text of `node`: after the end of the text before it, matched on its
 * last 16, 8, 4, 2 or 1 characters (markup and math break longer runs) nearest to where its share of the text falls; else after the line's markup.
 */
function caretIn(node: ProseNode, offset: number, source: string): number {
  const before = node.textBetween(0, Math.max(0, Math.min(offset, node.content.size)), "\n", "\u0000");
  const tail = before.slice(Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\u0000")) + 1);
  const estimate = Math.round((before.length / Math.max(1, node.textContent.length)) * source.length);
  for (const size of [16, 8, 4, 2, 1]) {
    const piece = tail.slice(-size);
    if (piece.length < Math.min(size, tail.length)) continue;
    const at = piece ? source.lastIndexOf(piece, estimate + size) : -1;
    if (at >= 0) return at + piece.length;
  }
  return /^(#{1,6}\s+|\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/.exec(source)?.[0].length ?? 0;
}

/** The blocks `text` reads as; the first keeps the gap before the blocks it replaces. */
function blocksOf(text: string, gap: unknown): ProseNode[] {
  const nodes: ProseNode[] = [];
  bodyToDoc(text).forEach((node) => nodes.push(node));
  if (nodes[0]) nodes[0] = nodes[0].type.create({ ...nodes[0].attrs, gap }, nodes[0].content, nodes[0].marks);
  return nodes;
}

/** One view's source editor: its element and the text it last wrote back. */
interface Session { readonly el: HTMLElement; readonly input: HTMLTextAreaElement; written: string }

function fit(input: HTMLTextAreaElement): void {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
}

/** Writes the editor's text back over the range, when it changed; returns the transaction, or null. */
function writeBack(view: EditorView, session: Session): Transaction | null {
  const range = key.getState(view.state);
  const text = session.input.value;
  if (!range || text === session.written) return null;
  session.written = text;
  const gap = view.state.doc.nodeAt(range.from)?.attrs.gap ?? null;
  const nodes = blocksOf(text, gap);
  const size = nodes.reduce((sum, node) => sum + node.nodeSize, 0);
  return view.state.tr.replaceWith(range.from, range.to, nodes).setMeta(key, { from: range.from, to: range.from + size });
}

/** Where the note's selection goes when the source closes, given the blocks it stood for. */
type Place = (state: EditorState, range: { from: number; to: number }) => Selection;

/** Writes back and shows the blocks rendered again; `place` then sets the note's selection, and the note takes the focus. */
function close(view: EditorView, session: Session, place?: Place): Transaction | null {
  const open = key.getState(view.state);
  if (view.isDestroyed || !open) return null;
  const tr = writeBack(view, session) ?? view.state.tr;
  const range = (tr.getMeta(key) as Range | undefined) ?? open;
  tr.setMeta(key, null);
  if (place && range) tr.setSelection(place(view.state.apply(tr), range));
  view.dispatch(tr);
  if (place) view.focus();
  return tr;
}

/** Opens the source of the block at `pos` with the caret where the note's caret was. */
function open(view: EditorView, session: Session, pos: number, node: ProseNode, offset: number): void {
  const text = sourceOf(view.state, node);
  session.input.value = text;
  session.written = text;
  view.dispatch(view.state.tr.setMeta(key, { from: pos, to: pos + node.nodeSize }));
  session.input.focus();
  const caret = caretIn(node, offset, text);
  session.input.setSelectionRange(caret, caret);
  fit(session.input);
}

function createSession(view: EditorView, pressing: () => boolean): Session {
  const input = renderElement("textarea", { class: "qmd-block-source-input", spellcheck: "false", rows: "1", "aria-label": "Block source" });
  const el = renderElement("div", { class: "qmd-block-source", contenteditable: "false" }, input);
  const session: Session = { el, input, written: "" };
  const save = createDebouncer(() => { const tr = writeBack(view, session); if (tr) view.dispatch(tr); }, 300);
  input.addEventListener("input", () => { fit(input); save.call(); });
  input.addEventListener("keydown", (event) => {
    const { selectionStart: start, selectionEnd: end, value } = input;
    const firstLine = start === end && !value.slice(0, start).includes("\n");
    const lastLine = start === end && !value.slice(end).includes("\n");
    let place: Place | undefined;
    if (event.key === "ArrowUp" && firstLine) place = (state, range) => Selection.near(state.doc.resolve(range.from), -1);
    else if (event.key === "ArrowDown" && lastLine) place = (state, range) => Selection.near(state.doc.resolve(range.to), 1);
    // Escape shows the block rendered and selects it, so the caret does not open it again.
    else if (event.key === "Escape") place = (state, range) => (state.doc.nodeAt(range.from) ? NodeSelection.create(state.doc, range.from) : Selection.near(state.doc.resolve(range.from)));
    if (!place) return;
    event.preventDefault();
    save.cancel();
    close(view, session, place);
  });
  // A focus that leaves for elsewhere (a click into another block, outside the note) shows the block rendered again.
  // A press in the note is left to its release, which closes this and opens what it hit.
  input.addEventListener("blur", () => { setTimeout(() => { if (document.activeElement !== input && !pressing()) { save.cancel(); close(view, session); } }, 0); });
  return session;
}

/** The source editor of `view` when it stands in for the block at `pos` (the gutter measures it in place of the hidden block). */
const sessions = new WeakMap<EditorView, Session>();
export function blockSourceAt(view: EditorView, pos: number): HTMLElement | null {
  return key.getState(view.state)?.from === pos ? sessions.get(view)?.el ?? null : null;
}

/** Opens the text block the caret moves into while Advanced is on, and closes the source when Advanced goes off. */
function watchCaret(view: EditorView): { update(view: EditorView, prev: EditorState): void; destroy(): void } {
  // What a press hit, read at the press: the layout changes once a block shown as source closes.
  let press: { x: number; y: number; block: number | null; pos: number } | null = null;
  const session = createSession(view, () => press !== null);
  sessions.set(view, session);
  const advancedOn = (): boolean => !view.isDestroyed && view.editable && foldStateOf(view.state).advanced;
  /** The start of the top-level block at `pos` (or of the block `inside` is, for a block without text such as an equation). */
  const blockAt = (pos: number, inside = -1): number | null => {
    const at = inside >= 0 ? inside : pos;
    const $at = view.state.doc.resolve(at);
    return $at.depth > 0 ? $at.before(1) : view.state.doc.nodeAt(at) ? at : null;
  };
  /** Opens the block starting at `start` with the caret `pos` in it, when it is one shown as source. */
  const openAt = (start: number | null, pos: number): void => {
    const node = start === null ? null : view.state.doc.nodeAt(start);
    if (start !== null && node && SOURCE_BLOCKS.has(node.type.name)) open(view, session, start, node, pos - start - 1);
  };
  const onDown = (event: MouseEvent): void => {
    if (!advancedOn() || event.button !== 0 || (event.target as Element | null)?.closest?.(".qmd-block-source")) { press = null; return; }
    const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
    press = { x: event.clientX, y: event.clientY, block: hit ? blockAt(hit.pos, hit.inside) : null, pos: hit?.pos ?? 0 };
  };
  // A click (not a drag) opens the block it hit, closing the one shown as source; the caret goes where it was clicked.
  const onUp = (event: MouseEvent): void => {
    const hit = press;
    press = null;
    if (!hit || Math.hypot(event.clientX - hit.x, event.clientY - hit.y) > 4) return;
    setTimeout(() => {
      if (!advancedOn()) return;
      const tr = close(view, session);
      const block = hit.block === null ? null : tr ? tr.mapping.map(hit.block, 1) : hit.block;
      const node = block === null ? null : view.state.doc.nodeAt(block);
      // A click on another kind of block (a cell, an output, a figure) is that block's own.
      if (block === null || !node || !SOURCE_BLOCKS.has(node.type.name)) return;
      const pos = Math.min(Math.max(tr ? tr.mapping.map(hit.pos) : hit.pos, block), block + node.nodeSize);
      view.focus();
      if (node.isTextblock || !node.isAtom) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))));
      if (!key.getState(view.state)) openAt(block, pos);
    }, 0);
  };
  view.dom.addEventListener("mousedown", onDown);
  window.addEventListener("mouseup", onUp);
  return {
    update(_view, prev) {
      const range = key.getState(view.state);
      if (range && !foldStateOf(view.state).advanced) { close(view, session); return; }
      // A caret moved by the keyboard opens its block, after its transaction is drawn; clicks open on their release.
      if (!range && !press && !prev.selection.eq(view.state.selection)) {
        queueMicrotask(() => {
          const { selection } = view.state;
          if (advancedOn() && !key.getState(view.state) && view.hasFocus() && selection instanceof TextSelection) openAt(blockAt(selection.from), selection.from);
        });
      }
    },
    destroy() { sessions.delete(view); view.dom.removeEventListener("mousedown", onDown); window.removeEventListener("mouseup", onUp); },
  };
}

export function blockSourcePlugin(): Plugin<Range> {
  return new Plugin<Range>({
    key,
    state: {
      init: () => null,
      apply(tr, range) {
        const meta = tr.getMeta(key) as Range | undefined;
        if (meta !== undefined) return meta;
        if (!range || !tr.docChanged) return range;
        const from = tr.mapping.map(range.from, 1);
        const to = tr.mapping.map(range.to, -1);
        return to > from ? { from, to } : null;
      },
    },
    props: {
      decorations(state) {
        const range = key.getState(state);
        if (!range) return null;
        const decorations: Decoration[] = [];
        state.doc.nodesBetween(range.from, range.to, (node, pos) => {
          if (pos >= range.from) decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "qmd-source-hidden" }));
          return false;
        });
        decorations.push(Decoration.widget(range.from, (view) => sessions.get(view)!.el, { side: 1, key: "qmd-block-source", stopEvent: () => true, ignoreSelection: true }));
        return DecorationSet.create(state.doc, decorations);
      },
    },
    view: watchCaret,
  });
}
