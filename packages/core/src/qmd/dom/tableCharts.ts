// Charts of a note's tables: Chart from table puts a data figure after the pipe table or raw LaTeX table at the selection, which
// follows the table through its label (a Quarto `: … {#tbl-…}` caption or a LaTeX `\label`, added when the table has none).
// Each edit of a table rewrites the figures that follow it in the same history step; their PNGs are drawn again once edits pause.
// CONTRACT: documents/contracts/qmd-items.md#figures
import type { Node as ProseNode } from "prosemirror-model";
import { NodeSelection, Plugin, PluginKey, type Command, type EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { ySyncPluginKey } from "y-prosemirror";
import { showToast } from "../../ui/dom/index.js";
import { captionLabel, figureOfTable, TABLE_CHART_LABELS, tableChartKinds, type TableChartKind, findLatexTables, formatChartPgf, labelLine, newFigureId, newTableLabel, readFigureBlock, readFigureModel, sameTable, tableOfRows, type ChartTable, type FigureBlock, type FigureModel } from "../chart/index.js";
import { rawFormatOf } from "../compute/index.js";
import { bodyToDoc, qmdSchema } from "../editor/index.js";
import { figureRaw, type FigureEditorLoader } from "./figureView.js";
import type { PlotlyLoader } from "./plotView.js";
import { CHART_ICONS, mountTableChartButton } from "./tableChartButton.js";

const nodes = { table: qmdSchema.nodes.table!, paragraph: qmdSchema.nodes.paragraph!, code: qmdSchema.nodes.code_cell!, figure: qmdSchema.nodes.figure! };
const PNG_DELAY_MS = 800;
const BOM = /^﻿/;

/** A cell's text, inline math as `$…$`. */
function cellText(cell: ProseNode): string {
  let text = "";
  cell.descendants((node) => {
    if (node.isText) text += node.text;
    else if (typeof node.attrs.tex === "string") text += `$${node.attrs.tex}$`;
    return true;
  });
  return text;
}

/** The chart table of a pipe table: its header row names the columns. */
function pipeTable(node: ProseNode): ChartTable {
  const rows: string[][] = [];
  node.forEach((row) => { const cells: string[] = []; row.forEach((cell) => cells.push(cellText(cell))); rows.push(cells); });
  return tableOfRows(rows, true);
}

const isLatexBlock = (node: ProseNode): boolean => node.type === nodes.code && rawFormatOf(node.attrs.lang as string | null) === "latex";

// Nodes do not change, so what is read from one is kept with it.
const pipeTables = new WeakMap<ProseNode, ChartTable>();
const latexTables = new WeakMap<ProseNode, ReturnType<typeof findLatexTables>>();
const figureBlocks = new WeakMap<ProseNode, FigureBlock | null>();
const once = <T>(cache: WeakMap<ProseNode, T>, node: ProseNode, read: (node: ProseNode) => T): T => {
  if (!cache.has(node)) cache.set(node, read(node));
  return cache.get(node)!;
};
const latexSpans = (node: ProseNode) => once(latexTables, node, (n) => findLatexTables(n.attrs.code as string));
const figureBlock = (node: ProseNode) => once(figureBlocks, node, (n) => readFigureBlock((n.attrs.raw as string).replace(BOM, "")));

/** A top-level table of the note: a pipe table (its end past its caption) or the first table of a raw LaTeX block. */
interface NoteTable { pos: number; node: ProseNode; kind: "markdown" | "latex"; label: string | null; table: ChartTable | null; end: number }

function noteTableAt(doc: ProseNode, index: number, pos: number): NoteTable | null {
  const node = doc.child(index);
  if (node.type === nodes.table) {
    const next = index + 1 < doc.childCount ? doc.child(index + 1) : null;
    const label = next?.type === nodes.paragraph ? captionLabel(next.textContent) : null;
    return { pos, node, kind: "markdown", label, table: once(pipeTables, node, pipeTable), end: pos + node.nodeSize + (label !== null ? next!.nodeSize : 0) };
  }
  const span = isLatexBlock(node) ? latexSpans(node)[0] : undefined;
  return span ? { pos, node, kind: "latex", label: span.label, table: span.table, end: pos + node.nodeSize } : null;
}

/** The labelled tables of the note; the first table of a label wins. */
function tablesByLabel(doc: ProseNode): Map<string, ChartTable> {
  const tables = new Map<string, ChartTable>();
  const add = (label: string | null, table: ChartTable | null): void => { if (label !== null && table !== null && !tables.has(label)) tables.set(label, table); };
  doc.forEach((node, pos, index) => {
    if (isLatexBlock(node)) for (const span of latexSpans(node)) add(span.label, span.table);
    else if (node.type === nodes.table) { const found = noteTableAt(doc, index, pos); add(found?.label ?? null, found?.table ?? null); }
  });
  return tables;
}

const crlf = (state: EditorState): boolean => state.doc.attrs.eol === "\r\n";

/** The block of a data figure drawn from `table`: its model, its pgfplots picture and the PNG it keeps. */
const blockParts = (model: FigureModel, table: ChartTable, png: FigureBlock["png"]): Omit<FigureBlock, "handEdited"> => ({ model, png, picture: formatChartPgf({ ...model, kind: "data" }, table), svg: null });

/** The rewrite of every figure whose table changed, and the ids of those figures, whose PNGs are now behind; null when none changed. */
function followTables(state: EditorState): { tr: Transaction; ids: string[] } | null {
  const { doc } = state;
  let tables: Map<string, ChartTable> | null = null;
  let tr: Transaction | null = null;
  const ids: string[] = [];
  for (let index = 0, pos = 0; index < doc.childCount; pos += doc.child(index).nodeSize, index++) {
    const node = doc.child(index);
    const block = node.type === nodes.figure ? figureBlock(node) : null;
    const label = block?.model.table;
    if (block === null || label === undefined) continue;
    tables ??= tablesByLabel(doc);
    const table = tables.get(label);
    const model = table && !sameTable(block.model.data, table) ? readFigureModel({ ...block.model, data: table }) : null;
    const raw = model && figureRaw(node.attrs.raw as string, blockParts(model, table!, block.png), crlf(state));
    if (!model || !raw) continue;
    tr = (tr ?? state.tr).setNodeAttribute(pos, "raw", raw);
    ids.push(model.id);
  }
  return tr && { tr, ids };
}

/** What a transaction tells the plugin: figures whose PNGs fell behind, and figures whose PNGs were drawn. */
interface FollowMeta { stale?: readonly string[]; drawn?: readonly string[] }

const followKey = new PluginKey<ReadonlySet<string>>("qmdTableCharts");

/** The figure with `id` and its position, or null. */
function findFigure(doc: ProseNode, id: string): { pos: number; node: ProseNode; block: FigureBlock } | null {
  let found: { pos: number; node: ProseNode; block: FigureBlock } | null = null;
  doc.forEach((node, pos) => {
    const block = found === null && node.type === nodes.figure ? figureBlock(node) : null;
    if (block?.model.id === id) found = { pos, node, block };
  });
  return found;
}

interface TableChartDeps { loadEditor: FigureEditorLoader; loadPlotly: PlotlyLoader; isExternal(tr: Transaction): boolean }

/** Draws the PNG of one stale figure and writes it outside the history; a figure edited meanwhile is left for the next round. */
async function redrawPng(view: EditorView, deps: TableChartDeps, id: string): Promise<void> {
  const found = findFigure(view.state.doc, id);
  const done = (): void => { view.dispatch(view.state.tr.setMeta(followKey, { drawn: [id] } satisfies FollowMeta)); };
  if (found === null) { done(); return; }
  const editor = await deps.loadEditor();
  const { png } = await editor.chartFigureParts(deps.loadPlotly, found.block.model, found.block.model.data ?? null);
  if (view.isDestroyed) return;
  const now = findFigure(view.state.doc, id);
  if (now === null || now.node.attrs.raw !== found.node.attrs.raw) return;
  const raw = png && figureRaw(now.node.attrs.raw as string, { ...found.block, png }, crlf(view.state));
  if (!raw) { done(); return; }
  view.dispatch(view.state.tr.setNodeAttribute(now.pos, "raw", raw).setMeta("addToHistory", false).setMeta(followKey, { drawn: [id] } satisfies FollowMeta));
}

/** The plugin view that draws the stale PNGs once edits pause, one figure at a time. */
function pngRedraws(view: EditorView, deps: TableChartDeps): { update(view: EditorView, prev: EditorState): void; destroy(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  const schedule = (): void => { clearTimeout(timer); timer = setTimeout(() => void run(), PNG_DELAY_MS); };
  const run = async (): Promise<void> => {
    if (running || view.isDestroyed) return;
    running = true;
    try {
      for (const id of followKey.getState(view.state) ?? []) {
        await redrawPng(view, deps, id).catch(() => { if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(followKey, { drawn: [id] } satisfies FollowMeta)); });
        if (view.isDestroyed) return;
      }
    } finally {
      running = false;
    }
    if ((followKey.getState(view.state)?.size ?? 0) > 0) schedule();
  };
  if ((followKey.getState(view.state)?.size ?? 0) > 0) schedule();
  return {
    update(current, prev) { if (followKey.getState(current.state) !== followKey.getState(prev) && (followKey.getState(current.state)?.size ?? 0) > 0) schedule(); },
    destroy() { clearTimeout(timer); },
  };
}

// y-prosemirror's typings resolve their own prosemirror-state copy, so its key is cast at this seam.
const isRemote = (tr: Transaction): boolean => (tr.getMeta(ySyncPluginKey as unknown as PluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin === true;

/** Keeps the figures that follow a table in step with it; a peer's or the host's text already holds its figures. */
export function tableChartsPlugin(deps: TableChartDeps): Plugin<ReadonlySet<string>> {
  return new Plugin<ReadonlySet<string>>({
    key: followKey,
    state: {
      init: () => new Set(),
      apply(tr, stale) {
        const meta = tr.getMeta(followKey) as FollowMeta | undefined;
        if (!meta) return stale;
        const next = new Set(stale);
        for (const id of meta.stale ?? []) next.add(id);
        for (const id of meta.drawn ?? []) next.delete(id);
        return next;
      },
    },
    appendTransaction(trs, _old, state) {
      if (!trs.some((tr) => tr.docChanged) || trs.some((tr) => tr.getMeta(followKey) !== undefined || deps.isExternal(tr) || isRemote(tr))) return null;
      const followed = followTables(state);
      return followed && followed.tr.setMeta(followKey, { stale: followed.ids } satisfies FollowMeta);
    },
    view: (view) => {
      const redraws = pngRedraws(view, deps);
      const button = tableButton(view);
      return { update(current, prev) { redraws.update(current, prev); if (current.state.doc !== prev.doc || !current.state.selection.eq(prev.selection)) button.update(); }, destroy() { redraws.destroy(); button.destroy(); } };
    },
  });
}

/** The table at `at` (the selection's start when absent): the top-level block holding it. */
function tableAt(state: EditorState, at = state.selection.from): NoteTable | null {
  const $at = state.doc.resolve(at);
  const index = $at.index(0);
  return index < state.doc.childCount ? noteTableAt(state.doc, index, $at.posAtIndex(index, 0)) : null;
}

/** The caption paragraph that labels a pipe table, as the note reads it back, a blank line after the table. */
function captionParagraph(label: string): ProseNode {
  const read = bodyToDoc(`: {#${label}}\n`).firstChild!;
  return read.type.create({ ...read.attrs, gap: null }, read.content);
}

/**
 * Chart from table: a data figure of the table at `at` (the selection's when absent) right after it and its caption, selected,
 * drawn as `kind` (the table's suggested kind when absent). A table without a label gets one first: a caption paragraph or a
 * `\label` line.
 */
export function chartTable(kind?: TableChartKind, at?: number): Command {
  return (state, dispatch) => {
    const found = tableAt(state, at);
    if (!found?.table || tableChartKinds(found.table).length === 0) return false;
    if (!dispatch) return true;
    const id = newFigureId();
    const label = found.label ?? newTableLabel(found.kind, id);
    const model = readFigureModel(figureOfTable(found.table, label, id, kind));
    if (!model) return false;
    const raw = figureRaw("", blockParts(model, found.table, null), crlf(state));
    if (raw === null) { showToast("This table is too large to chart in the note.", "error"); return true; }
    const tr = state.tr;
    let end = found.end;
    if (found.label === null && found.kind === "markdown") {
      const caption = captionParagraph(label);
      tr.insert(end, caption);
      end += caption.nodeSize;
    } else if (found.label === null) {
      const code = found.node.attrs.code as string;
      const line = labelLine(latexSpans(found.node)[0]!, label);
      tr.setNodeAttribute(found.pos, "code", code.slice(0, line.at) + line.text + code.slice(line.at));
    }
    tr.insert(end, nodes.figure.create({ raw }));
    dispatch(tr.setSelection(NodeSelection.create(tr.doc, end)).setMeta(followKey, { stale: [id] } satisfies FollowMeta).scrollIntoView());
    return true;
  };
}

/** Chart from table at the selection, as the suggested kind (the keyboard shortcut). */
export const chartFromTable: Command = chartTable();

const TABLE_DOM = ".qmd-table, .qmd-latex-table-preview";

/** The element a table shows as: a pipe table's, or a LaTeX block's preview while it shows; null while its source is open. */
function tableElement(view: EditorView, found: NoteTable): HTMLElement | null {
  const dom = view.nodeDOM(found.pos);
  if (!(dom instanceof HTMLElement)) return null;
  if (found.kind === "markdown") return dom;
  return dom.classList.contains("is-editing-source") ? null : dom.querySelector<HTMLElement>(".qmd-latex-table-preview");
}

/** The Chart button over the hovered table, or the table that holds the selection while the editor has the focus. */
function tableButton(view: EditorView): { update(): void; destroy(): void } {
  let hovered: number | null = null;
  const active = (): NoteTable | null => {
    const found = hovered !== null ? tableAt(view.state, hovered) : view.hasFocus() ? tableAt(view.state) : null;
    return found?.table && tableChartKinds(found.table).length > 0 ? found : null;
  };
  const button = mountTableChartButton({
    dom: view.dom,
    target: () => {
      const found = active();
      const el = found && tableElement(view, found);
      if (!el) return null;
      const controls = el.querySelector<HTMLElement>(":scope > .qmd-media-controls");
      return { rect: el.getBoundingClientRect(), inset: controls && !controls.hidden ? controls.offsetWidth + 4 : 0 };
    },
    menu: () => {
      const found = active();
      return found ? tableChartKinds(found.table!).map((kind, i) => ({
        label: TABLE_CHART_LABELS[kind], icon: CHART_ICONS[kind], ...(i === 0 ? { hint: "Suggested" } : {}),
        onSelect: () => { chartTable(kind, found.pos)(view.state, view.dispatch.bind(view)); view.focus(); },
      })) : [];
    },
    leave: () => { hovered = null; button.place(); },
  });
  const onMove = (event: MouseEvent): void => {
    const el = (event.target as Element | null)?.closest?.(TABLE_DOM);
    const next = el instanceof HTMLElement && view.dom.contains(el) ? view.posAtDOM(el, 0) : null;
    if (next === hovered) return;
    hovered = next;
    button.place();
  };
  const onLeave = (event: MouseEvent): void => {
    if (event.relatedTarget instanceof Node && button.element.contains(event.relatedTarget)) return;
    hovered = null;
    button.place();
  };
  const onBlur = (): void => button.place();
  view.dom.addEventListener("mousemove", onMove);
  view.dom.addEventListener("mouseleave", onLeave);
  view.dom.addEventListener("focusout", onBlur);
  return {
    update() { hovered = null; button.place(); },
    destroy() {
      view.dom.removeEventListener("mousemove", onMove);
      view.dom.removeEventListener("mouseleave", onLeave);
      view.dom.removeEventListener("focusout", onBlur);
      button.destroy();
    },
  };
}
