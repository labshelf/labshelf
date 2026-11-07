// Shows a raw LaTeX table block (```{=latex} with a tabular) as a rendered table while its source is not being edited;
// double-clicking the table (or Enter on the selected block) opens the source, and leaving the source shows the table again. In an
// editable editor the width field and alignment buttons at the top right of the row write the layout into the LaTeX.
import type { EditorView } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { rawFormatOf } from "../compute/index.js";
import { parseLatexTable, readLatexTableLayout, setLatexTableLayout, type LatexCell, type LatexInline, type LatexRule, type LatexTable } from "../latexTable/index.js";
import { mountMediaControls, showMediaLayout, type MediaControls } from "./mediaControls.js";
import { loadCoreMath, renderMathInto, type MathLoader } from "./mathView.js";

/** Renders inline cell or caption content into `parent`; math goes through MathJax lazily. */
function renderInline(parent: HTMLElement, nodes: readonly LatexInline[], loadMath: MathLoader): void {
  for (const node of nodes) {
    if (node.type === "text") { parent.append(node.text); continue; }
    if (node.type === "math") {
      const target = renderElement("span", { class: "qmd-latex-table-math" });
      parent.append(target);
      void renderMathInto(target, node.tex, false, loadMath);
      continue;
    }
    const tag = node.type === "bold" ? "strong" : node.type === "italic" ? "em" : "code";
    const styled = renderElement(tag);
    renderInline(styled, node.children, loadMath);
    parent.append(styled);
  }
}

/** The class a cell edge gets for the rules on it: two or more plain rules are a double line, booktabs' outer rules are thick. */
function ruleWeight(rules: ReadonlySet<LatexRule>): "thick" | "double" | "thin" {
  const kinds = [...rules].map((rule) => rule.kind);
  if (kinds.includes("toprule") || kinds.includes("bottomrule")) return "thick";
  return kinds.length > 1 ? "double" : "thin";
}

const barClass = (side: "left" | "right", count: number): string | null => (count <= 0 ? null : count > 1 ? `rule-${side}-double` : `rule-${side}`);

function renderCell(cell: LatexCell, loadMath: MathLoader): HTMLTableCellElement {
  const td = document.createElement("td");
  if (cell.colspan > 1) td.colSpan = cell.colspan;
  if (cell.rowspan > 1) td.rowSpan = cell.rowspan;
  td.classList.add(`align-${cell.align}`);
  for (const name of [barClass("left", cell.leftRule), barClass("right", cell.rightRule)]) if (name) td.classList.add(name);
  renderInline(td, cell.content, loadMath);
  return td;
}

/** Renders a parsed table: caption, column widths, cells with their spans and alignment, and its rules as cell borders. */
export function renderLatexTable(table: LatexTable, loadMath: MathLoader = loadCoreMath): HTMLTableElement {
  const el = renderElement("table", { class: "qmd-latex-table" });
  if (table.caption) {
    const caption = renderElement("caption", { class: table.captionPosition === "below" ? "is-below" : null });
    renderInline(caption, table.caption, loadMath);
    el.append(caption);
  }
  if (table.columns.some((column) => column.width)) {
    el.append(renderElement("colgroup", {}, ...table.columns.map((column) => renderElement("col", { style: column.width ? `width: ${column.width}` : null }))));
  }
  // Which cell covers each row and column, and the row it starts at, so a rule finds the cell edge it lies on.
  const grid: Array<Array<{ td: HTMLTableCellElement; row: number } | undefined>> = table.rows.map(() => []);
  const body = renderElement("tbody");
  table.rows.forEach((row, r) => {
    const tr = renderElement("tr");
    for (const cell of row) {
      const td = renderCell(cell, loadMath);
      tr.append(td);
      for (let k = r; k < Math.min(r + cell.rowspan, table.rows.length); k++) for (let c = cell.column; c < cell.column + cell.colspan; c++) grid[k]![c] = { td, row: r };
    }
    body.append(tr);
  });
  el.append(body);
  const edges = new Map<HTMLTableCellElement, { top: Set<LatexRule>; bottom: Set<LatexRule> }>();
  table.rules.forEach((rules, r) => {
    const below = r === table.rows.length;
    for (const rule of rules) {
      for (let c = rule.from - 1; c < rule.to; c++) {
        const slot = below ? grid[r - 1]?.[c] : grid[r]?.[c];
        // A rule across a multirow cell is not drawn through it.
        if (!slot || (!below && slot.row !== r)) continue;
        const edge = edges.get(slot.td) ?? { top: new Set<LatexRule>(), bottom: new Set<LatexRule>() };
        edges.set(slot.td, edge);
        (below ? edge.bottom : edge.top).add(rule);
      }
    }
  });
  for (const [td, edge] of edges) {
    if (edge.top.size > 0) td.classList.add(`rule-top-${ruleWeight(edge.top)}`);
    if (edge.bottom.size > 0) td.classList.add(`rule-bottom-${ruleWeight(edge.bottom)}`);
  }
  return el;
}

export interface LatexTablePreviewOptions {
  /** The cell's root; it gets `qmd-cell-latex-table` while it previews a table and `is-editing-source` while its source is open. */
  dom: HTMLElement;
  /** The element the preview goes before (the cell's code panel). */
  before: HTMLElement;
  /** The source editor's element; focus leaving it shows the table again. */
  sourceDom: HTMLElement;
  view: EditorView;
  /** The block's fence language and code. */
  lang: () => string | null;
  code: () => string;
  /** Opens the source editor (the cell's own node editor). */
  edit: () => void;
  /** Writes new code into the block as one transaction; without it the table has no layout controls. */
  setCode?: (code: string) => void;
  loadMath?: MathLoader;
}

export interface LatexTablePreview {
  /** Re-reads the block: shows, updates or removes the preview. */
  sync(): void;
  /** The source is being opened: hide the preview until focus leaves the source. */
  showSource(): void;
  destroy(): void;
}

/** The table's width (a percentage) and alignment as its LaTeX writes them. */
const tableLayout = (options: LatexTablePreviewOptions) => readLatexTableLayout(options.code());
const tableWidth = (options: LatexTablePreviewOptions): string | null => { const percent = tableLayout(options).width; return percent === null ? null : `${percent}%`; };

/** The width field and alignment buttons over the preview, when the block can be written and the editor is editable. */
function tableLayoutControls(options: LatexTablePreviewOptions, preview: HTMLElement, drawn: () => HTMLTableElement | null): MediaControls | null {
  const { setCode } = options;
  return setCode && options.view.editable ? mountMediaControls(preview, {
    width: () => tableWidth(options),
    align: () => tableLayout(options).align,
    preview: (next, align) => { const table = drawn(); if (table) showMediaLayout(table, next, align); },
    commit: (next, align) => setCode(setLatexTableLayout(options.code(), { width: next === null ? null : parseFloat(next), align })),
  }) : null;
}

/** Opens the source on a double click (one click with the Advanced switch on, as a text block's does) and runs `left` when focus moves elsewhere in the page; returns the removal of both listeners. */
function listenForSource(options: LatexTablePreviewOptions, preview: HTMLElement, left: () => void): () => void {
  const { sourceDom, view } = options;
  const onClick = (event: MouseEvent): void => { if (view.editable && (event.detail >= 2 || view.dom.closest(".qmd-editor.is-advanced"))) options.edit(); };
  // Focus leaving the window keeps the source's element active: only a move elsewhere in the page closes the source.
  const onFocusOut = (): void => { setTimeout(() => { if (!sourceDom.contains(document.activeElement)) left(); }, 0); };
  preview.addEventListener("click", onClick);
  sourceDom.addEventListener("focusout", onFocusOut);
  return () => {
    preview.removeEventListener("click", onClick);
    sourceDom.removeEventListener("focusout", onFocusOut);
  };
}

/**
 * Previews the block when it is a raw LaTeX table (`rawFormatOf(lang) === "latex"` and parseLatexTable reads it); any
 * other block, and LaTeX the parser cannot read, keeps the source view. Read-only editors only preview.
 */
export function attachLatexTablePreview(options: LatexTablePreviewOptions): LatexTablePreview {
  const { dom, before, view } = options;
  const loadMath = options.loadMath ?? loadCoreMath;
  const preview = renderElement("div", { class: "qmd-latex-table-preview", contenteditable: "false" });
  let key: string | null = null;
  let editing = false;
  let drawn: HTMLTableElement | null = null;
  const controls = tableLayoutControls(options, preview, () => drawn);
  const setEditing = (on: boolean): void => {
    editing = on;
    dom.classList.toggle("is-editing-source", on);
  };
  const sync = (): void => {
    const code = options.code();
    const table = rawFormatOf(options.lang()) === "latex" ? parseLatexTable(code) : null;
    dom.classList.toggle("qmd-cell-latex-table", table !== null);
    if (!table) { key = null; preview.remove(); return; }
    if (!preview.isConnected) before.before(preview);
    preview.title = view.editable ? "Click to edit the LaTeX" : "";
    // While the source is open the preview is hidden; it is redrawn when the source is left.
    if (editing || code === key) return;
    key = code;
    // The table is swapped alone, so a focused width field keeps its focus.
    const next = renderLatexTable(table, loadMath);
    if (drawn?.parentNode === preview) drawn.replaceWith(next);
    else preview.prepend(next);
    drawn = next;
    showMediaLayout(next, tableWidth(options), tableLayout(options).align);
    controls?.sync();
  };
  const unlisten = listenForSource(options, preview, () => { if (!editing) return; setEditing(false); sync(); });
  sync();
  return {
    sync,
    showSource: () => { if (dom.classList.contains("qmd-cell-latex-table")) setEditing(true); },
    destroy: () => { unlisten(); preview.remove(); },
  };
}
