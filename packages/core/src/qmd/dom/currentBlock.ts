// The current block (plan advanced-notes D6): with the Advanced switch on, the top-level block that holds the caret, while the editor has the focus, gets
// `is-current-block` (a subtle ground, CSS). A cell counts with its outputs. A cell's code editor keeps its own selection and never moves the note's,
// so the focus entering a block's nested editor names that block instead.
import type { Node as ProseNode } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { foldStateOf } from "./foldPlugin.js";

/** Whether the editor holds the focus, and the start of the top-level block whose nested editor has it (null: the note's own selection counts). */
interface Current { readonly focused: boolean; readonly nested: number | null }

const key = new PluginKey<Current>("qmdCurrentBlock");
const CLASS = { class: "is-current-block" };

/** The start of the top-level block holding the selection's head, or null in an empty document. */
function blockAtSelection(state: EditorState): number | null {
  const { $head } = state.selection;
  if ($head.depth > 0) return $head.before(1);
  // A node selection of a top-level block (a cell, an equation) has its head after it: the block before the head, else the one after.
  const selected = state.selection.from;
  return state.doc.nodeAt(selected) ? selected : null;
}

/** The decorations of the block at `pos` and, for a cell, of the outputs right after it. */
function decorate(doc: ProseNode, pos: number): DecorationSet {
  const node = doc.nodeAt(pos);
  if (!node) return DecorationSet.empty;
  const decorations = [Decoration.node(pos, pos + node.nodeSize, CLASS)];
  if (node.type.name === "code_cell") {
    for (let at = pos + node.nodeSize, next = doc.nodeAt(at); next?.type.name === "output"; at += next.nodeSize, next = doc.nodeAt(at)) {
      decorations.push(Decoration.node(at, at + next.nodeSize, CLASS));
    }
  }
  return DecorationSet.create(doc, decorations);
}

/** The start of the top-level block of `view` whose DOM holds `target`, when `target` sits in a nested editor (a cell's code). */
function nestedBlockOf(view: EditorView, target: EventTarget | null): number | null {
  if (!(target instanceof Element) || target === view.dom || !target.closest(".cm-editor")) return null;
  let found: number | null = null;
  view.state.doc.forEach((_node, pos) => { if (found === null && view.nodeDOM(pos)?.contains(target)) found = pos; });
  return found;
}

/** The start of the top-level block whose nested editor (a cell's code) has the focus, else null: the note's selection names the block. */
export function nestedFocusOf(state: EditorState): number | null {
  const current = key.getState(state);
  return current?.focused ? current.nested : null;
}

export function currentBlockPlugin(): Plugin<Current> {
  return new Plugin<Current>({
    key,
    state: {
      init: () => ({ focused: false, nested: null }),
      apply(tr, value) {
        const next = (tr.getMeta(key) as Current | undefined) ?? value;
        if (next.nested === null || !tr.docChanged) return next;
        const mapped = tr.mapping.mapResult(next.nested, 1);
        return { ...next, nested: mapped.deleted ? null : mapped.pos };
      },
    },
    props: {
      decorations(state) {
        const current = key.getState(state)!;
        if (!current.focused || !foldStateOf(state).advanced) return null;
        const pos = current.nested ?? blockAtSelection(state);
        return pos === null ? null : decorate(state.doc, pos);
      },
    },
    view(view) {
      const set = (next: Current): void => {
        const now = key.getState(view.state)!;
        if (!view.isDestroyed && (now.focused !== next.focused || now.nested !== next.nested)) view.dispatch(view.state.tr.setMeta(key, next).setMeta("addToHistory", false));
      };
      const onFocusIn = (event: FocusEvent): void => set({ focused: true, nested: nestedBlockOf(view, event.target) });
      // A move to another element inside the editor is followed by its own focusin; only a focus that left the editor clears the mark.
      const onFocusOut = (): void => { setTimeout(() => { if (!view.isDestroyed && !view.dom.contains(document.activeElement)) set({ focused: false, nested: null }); }, 0); };
      view.dom.addEventListener("focusin", onFocusIn);
      view.dom.addEventListener("focusout", onFocusOut);
      return {
        destroy() {
          view.dom.removeEventListener("focusin", onFocusIn);
          view.dom.removeEventListener("focusout", onFocusOut);
        },
      };
    },
  });
}
