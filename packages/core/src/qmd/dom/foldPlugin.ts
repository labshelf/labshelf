// Collapsing (plan D8): collapsed cells, collapsed sections and reading mode as view-only plugin state, drawn as node decorations (classes only; CSS hides).
// Named 'collapse' to stay distinct from the code fold of a cell with a result (CellControls.folded, qmd-cell-folded). Never in the document: the body is byte-identical.
import type { Node as ProseNode } from "prosemirror-model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { cellSummary, type CellSummaryState } from "./cellSummary.js";
import { scanDoc } from "./notebookCells.js";

export interface FoldState { readonly cells: ReadonlySet<string>; readonly sections: ReadonlySet<string>; readonly reading: boolean }

/** A change to the fold state; `all` collapses every top-level section and every cell outside a section (true) or clears every collapse (false). */
type FoldChange = { cell?: [string, boolean]; section?: [string, boolean]; reading?: boolean; all?: boolean };
type FoldMeta = { change: FoldChange } | { expandSections: readonly string[] } | { replace: { cells: Iterable<string>; sections: Iterable<string>; reading: boolean } };

const EMPTY: FoldState = { cells: new Set(), sections: new Set(), reading: false };
const key = new PluginKey<FoldState>("qmdFold");
const listeners = new WeakMap<EditorView, Set<() => void>>();

interface CellSpot { readonly key: string; readonly pos: number; readonly node: ProseNode; readonly outputs: readonly { pos: number; node: ProseNode }[] }
/** A top-level heading's section: the heading, and the top-level blocks from `from` to `to` up to the next heading of the same or a higher level. */
interface SectionSpot { readonly key: string; readonly pos: number; readonly node: ProseNode; readonly from: number; readonly to: number; readonly blocks: number; readonly topLevel: boolean }

/**
 * The cells by fold key (label, else `cell-<n>` among all code cells, as notebookCells.ts keys them without the item prefix) with their output siblings,
 * and the sections of the top-level headings by sectionKey (occurrences counted over every heading, as notebookCells.ts does).
 */
function layout(doc: ProseNode): { cells: CellSpot[]; sections: SectionSpot[]; firstHeading: number } {
  const scanned = scanDoc(doc);
  const headingKeys = new Map<number, string>(scanned.headings.map((heading) => [heading.pos, heading.key]));
  const cells: CellSpot[] = scanned.cells.map(({ key, pos, node, parent, index }) => {
    const outputs: { pos: number; node: ProseNode }[] = [];
    let at = pos + node.nodeSize;
    for (let i = index + 1; parent && i < parent.childCount && parent.child(i).type.name === "output"; i++) {
      outputs.push({ pos: at, node: parent.child(i) });
      at += parent.child(i).nodeSize;
    }
    return { key, pos, node, outputs };
  });
  const blocks: { pos: number; node: ProseNode }[] = [];
  doc.forEach((node, pos) => blocks.push({ pos, node }));
  const sections: SectionSpot[] = [];
  let minLevel = Infinity;
  blocks.forEach(({ pos, node }, i) => {
    if (node.type.name !== "heading") return;
    const level = node.attrs.level as number;
    let j = i + 1;
    while (j < blocks.length && !(blocks[j]!.node.type.name === "heading" && (blocks[j]!.node.attrs.level as number) <= level)) j++;
    const to = j < blocks.length ? blocks[j]!.pos : doc.content.size;
    sections.push({ key: headingKeys.get(pos)!, pos, node, from: pos + node.nodeSize, to, blocks: j - i - 1, topLevel: level <= minLevel });
    minLevel = Math.min(minLevel, level);
  });
  return { cells, sections, firstHeading: sections[0]?.pos ?? Infinity };
}

function reduce(value: FoldState, change: FoldChange, doc: ProseNode): FoldState {
  let cells = new Set(value.cells);
  let sections = new Set(value.sections);
  if (change.all === true) {
    const { cells: allCells, sections: allSections, firstHeading } = layout(doc);
    for (const section of allSections) if (section.topLevel) sections.add(section.key);
    for (const cell of allCells) if (cell.pos < firstHeading) cells.add(cell.key);
  } else if (change.all === false) {
    cells = new Set();
    sections = new Set();
  }
  if (change.cell) { if (change.cell[1]) cells.add(change.cell[0]); else cells.delete(change.cell[0]); }
  if (change.section) { if (change.section[1]) sections.add(change.section[0]); else sections.delete(change.section[0]); }
  return { cells, sections, reading: change.reading ?? value.reading };
}

/** A loaded state: only the cells and sections that exist in `doc` stay. */
function replaced(loaded: { cells: Iterable<string>; sections: Iterable<string>; reading: boolean }, doc: ProseNode): FoldState {
  const { cells, sections } = layout(doc);
  const cellKeys = new Set(cells.map((cell) => cell.key));
  const sectionKeys = new Set(sections.map((section) => section.key));
  return { cells: new Set([...loaded.cells].filter((cell) => cellKeys.has(cell))), sections: new Set([...loaded.sections].filter((section) => sectionKeys.has(section))), reading: loaded.reading };
}

/** The collapsed sections whose hidden blocks the range from `from` to `to` touches. */
function sectionsHiding(sections: readonly SectionSpot[], collapsed: ReadonlySet<string>, from: number, to: number): SectionSpot[] {
  return sections.filter((section) => collapsed.has(section.key) && section.from < section.to && from < section.to && Math.max(to, from + 1) > section.from);
}

/** What a collapsed cell's decoration carries to its view: the summary line without the out-of-date states, which the view reads from its outputs. */
interface CollapsedSpec { readonly qmdCollapsed: true; readonly summaryText: string; readonly summaryState: CellSummaryState }

/** The summary a collapsed cell's view shows, from its decorations; null when the cell is not collapsed. */
export function collapsedSummary(decorations: readonly Decoration[]): { text: string; state: CellSummaryState } | null {
  const spec = decorations.map((decoration) => decoration.spec as Partial<CollapsedSpec>).find((candidate) => candidate.qmdCollapsed === true);
  return spec ? { text: spec.summaryText!, state: spec.summaryState! } : null;
}

/** The chevron button after a heading's text (and '(N blocks)' when collapsed); a click collapses or expands that heading's section. */
function sectionToggle(sectionKeyValue: string, blocks: number, collapsed: boolean): (view: EditorView) => HTMLElement {
  return (view) => {
    const label = collapsed ? "Expand section" : "Collapse section";
    const button = renderElement("button", { class: "qmd-section-toggle", type: "button", contenteditable: "false", "aria-expanded": String(!collapsed), "aria-label": label, title: label },
      renderElement("span", { class: "qmd-section-toggle-icon", html: renderIcon(collapsed ? "chevron-right" : "chevron-down"), "aria-hidden": "true" }));
    if (collapsed) button.append(renderElement("span", { class: "qmd-section-count" }, `(${blocks} ${blocks === 1 ? "block" : "blocks"})`));
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => setFold(view, { section: [sectionKeyValue, !collapsed] }));
    return button;
  };
}

/** What a heading offers besides its chevron: Run section, which runs the cells of that heading's section (plan D10). */
export interface FoldPluginOptions { runSection?(sectionKey: string): void; canRun?(): boolean }

/** The Run section button after a heading's chevron; disabled, saying why, while the note has no runner. */
function sectionRun(sectionKeyValue: string, runSection: (sectionKey: string) => void, canRun: () => boolean): () => HTMLElement {
  return () => {
    const enabled = canRun();
    const button = renderElement("button", { class: "qmd-section-run", type: "button", contenteditable: "false", "aria-label": "Run section", title: enabled ? "Run section" : "No runner for this note", disabled: enabled ? undefined : true },
      renderElement("span", { class: "qmd-section-run-icon", html: renderIcon("play"), "aria-hidden": "true" }));
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => { if (canRun()) runSection(sectionKeyValue); });
    return button;
  };
}

function buildDecorations(doc: ProseNode, fold: FoldState, options: FoldPluginOptions): DecorationSet {
  const { cells, sections } = layout(doc);
  if (sections.length === 0 && fold.cells.size === 0 && !fold.reading) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  const now = new Date();
  for (const cell of cells) {
    // Reading mode shows a cell without output as its summary line in place of its code.
    if (!fold.cells.has(cell.key) && !(fold.reading && cell.outputs.length === 0)) continue;
    const summary = cellSummary(cell.node, cell.outputs.map((output) => output.node), now);
    const spec: CollapsedSpec = { qmdCollapsed: true, summaryText: summary.text, summaryState: summary.state };
    decorations.push(Decoration.node(cell.pos, cell.pos + cell.node.nodeSize, { class: "qmd-collapsed" }, spec));
    for (const output of cell.outputs) decorations.push(Decoration.node(output.pos, output.pos + output.node.nodeSize, { class: "qmd-collapsed-output" }));
  }
  const hidden = new Set<number>();
  for (const section of sections) {
    const collapsed = fold.sections.has(section.key);
    decorations.push(Decoration.widget(section.from - 1, sectionToggle(section.key, section.blocks, collapsed), { side: 1, ignoreSelection: true, key: `qmd-section-toggle:${section.key}:${collapsed}:${section.blocks}` }));
    if (options.runSection) {
      const canRun = options.canRun ?? (() => true);
      decorations.push(Decoration.widget(section.from - 1, sectionRun(section.key, options.runSection, canRun), { side: 2, ignoreSelection: true, key: `qmd-section-run:${section.key}:${canRun()}` }));
    }
    if (!collapsed) continue;
    decorations.push(Decoration.node(section.pos, section.from, { class: "qmd-section-collapsed" }));
    doc.nodesBetween(section.from, section.to, (node, pos) => {
      if (pos >= section.from && pos < section.to && !hidden.has(pos)) {
        hidden.add(pos);
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "qmd-in-collapsed-section" }));
      }
      return false;
    });
  }
  return DecorationSet.create(doc, decorations);
}

/**
 * The plugin: fold state in, node decorations and the `is-reading` class on the enclosing `.qmd-editor` out; a selection entering a collapsed section's hidden blocks expands it.
 * With `runSection`, every heading also gets a Run section button beside its chevron.
 */
export function foldPlugin(options: FoldPluginOptions = {}): Plugin<FoldState> {
  let cache: { doc: ProseNode; fold: FoldState; set: DecorationSet } | null = null;
  return new Plugin<FoldState>({
    key,
    state: {
      init: () => EMPTY,
      apply(tr, value, _old, next) {
        const meta = tr.getMeta(key) as FoldMeta | undefined;
        if (!meta) return value;
        if ("change" in meta) return reduce(value, meta.change, next.doc);
        if ("replace" in meta) return replaced(meta.replace, next.doc);
        const sections = new Set(value.sections);
        for (const expanded of meta.expandSections) sections.delete(expanded);
        return { ...value, sections };
      },
    },
    appendTransaction(trs: readonly Transaction[], old: EditorState, next: EditorState) {
      if (trs.some((tr) => tr.getMeta(key) !== undefined) || old.selection.eq(next.selection)) return null;
      const fold = key.getState(next)!;
      if (fold.sections.size === 0) return null;
      const { from, to } = next.selection;
      const hit = sectionsHiding(layout(next.doc).sections, fold.sections, from, to);
      if (hit.length === 0) return null;
      const meta: FoldMeta = { expandSections: hit.map((section) => section.key) };
      return next.tr.setMeta(key, meta).setMeta("addToHistory", false);
    },
    props: {
      decorations(state) {
        const fold = key.getState(state)!;
        if (cache?.doc !== state.doc || cache.fold !== fold) cache = { doc: state.doc, fold, set: buildDecorations(state.doc, fold, options) };
        return cache.set;
      },
    },
    view(editorView) {
      const sync = (reading: boolean): void => { editorView.dom.closest(".qmd-editor")?.classList.toggle("is-reading", reading); };
      let shown = foldStateOf(editorView.state).reading;
      if (shown) sync(true);
      return {
        update(updated, prev) {
          const fold = foldStateOf(updated.state);
          if (fold.reading !== shown) { shown = fold.reading; sync(fold.reading); }
          if (fold !== foldStateOf(prev)) for (const listener of [...(listeners.get(editorView) ?? [])]) listener();
        },
        destroy() { if (shown) sync(false); },
      };
    },
  });
}

/** The fold state of `state`: empty sets and reading off when the plugin is absent. */
export function foldStateOf(state: EditorState): FoldState {
  return key.getState(state) ?? EMPTY;
}

/** Calls `listener` after every change of the fold state of `view` (including a section expanded by the caret); returns the function that stops it. */
export function onFoldChange(view: EditorView, listener: () => void): () => void {
  const set = listeners.get(view) ?? new Set<() => void>();
  listeners.set(view, set);
  set.add(listener);
  return () => { set.delete(listener); };
}

/** Replaces the whole fold state of `view` with a loaded one (keys not in the document are dropped), outside the undo history and without touching the document. Does nothing without the plugin. */
export function replaceFold(view: EditorView, loaded: { cells: Iterable<string>; sections: Iterable<string>; reading: boolean }): void {
  dispatchFold(view, { replace: loaded }, replaced(loaded, view.state.doc));
}

/** Changes what is collapsed in `view`, outside the undo history and without touching the document; a caret inside a newly hidden section moves to its heading. Does nothing without the plugin. */
export function setFold(view: EditorView, change: { cell?: [string, boolean]; section?: [string, boolean]; reading?: boolean; all?: boolean }): void {
  if (view.isDestroyed || !key.getState(view.state)) return;
  dispatchFold(view, { change }, reduce(foldStateOf(view.state), change, view.state.doc));
}

function dispatchFold(view: EditorView, meta: FoldMeta, next: FoldState): void {
  if (view.isDestroyed || !key.getState(view.state)) return;
  const tr = view.state.tr.setMeta(key, meta).setMeta("addToHistory", false);
  const { from, to } = view.state.selection;
  const hit = sectionsHiding(layout(view.state.doc).sections, next.sections, from, to);
  if (hit.length > 0) {
    const outer = hit.reduce((a, b) => (a.pos <= b.pos ? a : b));
    tr.setSelection(TextSelection.create(tr.doc, outer.from - 1));
  }
  view.dispatch(tr);
}
