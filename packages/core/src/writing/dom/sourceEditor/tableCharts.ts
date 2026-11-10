// Charts of the tables of a LaTeX source: the Chart button over a hovered table, or the one holding the cursor, writes a data
// figure (pgfplots) of the kind picked after the table, which follows the table through its `\label` (one is added when the
// table has none); every edit of the text rewrites each such figure whose table changed, in the same transaction, so one undo
// takes back both.
// CONTRACT: documents/contracts/qmd-items.md#figures
import { Annotation, EditorState, Transaction, type AnnotationType, type ChangeSpec, type Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { ySyncAnnotation } from "y-codemirror.next";
import { findLatexTables, figureOfTable, formatChartPgf, labelLine, newFigureId, newTableLabel, PGF_CHART_KINDS, readFigureModel, sameTable, TABLE_CHART_LABELS, tableChartKinds, type ChartTable, type FigureModel, type LatexTableSpan, type TableChartKind } from "../../../qmd/chart/index.js";
import { CHART_ICONS, mountTableChartButton, type TableChartButton, type TableChartTarget } from "../../../qmd/dom/tableChartButton.js";
import { showToast, type MenuEntry } from "../../../ui/dom/index.js";
import { activeBlock, blockBox, remeasure } from "./blockButton.js";
import { ensurePackage, formatFigureLines } from "./drawingBlocks.js";
import { fromDisk } from "./openEditors.js";

const START = "% labshelf-figure ";
const END = "% end labshelf-figure";

/** A figure block of the text that follows a table: from its start marker's line start to its end marker's line end. */
interface LinkedFigure { from: number; to: number; model: FigureModel }

function readModel(json: string): FigureModel | null {
  try {
    return readFigureModel(JSON.parse(json));
  } catch {
    return null;
  }
}

/** The figure blocks of a LaTeX text whose model names a `table`. */
export function findLinkedFigures(text: string): LinkedFigure[] {
  const figures: LinkedFigure[] = [];
  let open: { from: number; model: FigureModel } | null = null;
  let at = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith(START)) {
      const model = readModel(trimmed.slice(START.length));
      open = model?.table !== undefined ? { from: at, model } : null;
    } else if (open !== null && trimmed.startsWith(END)) {
      figures.push({ ...open, to: at + line.length });
      open = null;
    }
    at += line.length + 1;
  }
  return figures;
}

/** The pgfplots picture of a data figure drawn from `table`, or null when pgfplots cannot draw it. */
const picture = (model: FigureModel, table: ChartTable): string | null => formatChartPgf({ ...model, kind: "data" }, table);

/** The edits that bring each linked figure up to date with its table: the model's data and the picture. A figure whose table is gone, or that pgfplots cannot draw from it, is left as it is. */
export function linkedFigureEdits(text: string): { from: number; to: number; insert: string }[] {
  const figures = findLinkedFigures(text);
  if (figures.length === 0) return [];
  const tables = new Map<string, ChartTable>();
  for (const span of findLatexTables(text)) if (span.label !== null && span.table !== null && !tables.has(span.label)) tables.set(span.label, span.table);
  return figures.flatMap((figure) => {
    const table = tables.get(figure.model.table!);
    const next = table && !sameTable(figure.model.data, table) ? readFigureModel({ ...figure.model, data: table }) : null;
    if (!table || !next) return [];
    const drawn = picture(next, table);
    return drawn === null ? [] : [{ from: figure.from, to: figure.to, insert: formatFigureLines(next, drawn) }];
  });
}

// y-codemirror.next's typings resolve their own @codemirror/state copy, so its annotation is cast at this seam.
const peerEdit = ySyncAnnotation as unknown as AnnotationType<unknown>;

/** Marks the edits of the follow, so they are not followed again. */
const followed = Annotation.define<boolean>();

/** Rewrites, in the same transaction, the linked figures an edit of their tables changed; text from the disk, the host or a peer already holds its figures. */
const linkedFigureSync: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(followed) || tr.annotation(fromDisk) || tr.annotation(Transaction.remote) || tr.annotation(peerEdit) !== undefined) return tr;
  const text = tr.newDoc.toString();
  if (!text.includes(START)) return tr;
  const changes = linkedFigureEdits(text);
  return changes.length === 0 ? tr : [tr, { changes, sequential: true, annotations: followed.of(true) }];
});

/**
 * Chart from table: a data figure of the table at `at` after it, drawn as `kind` (the table's suggested kind when absent), and a
 * `\label` on the table when it has none; false, with a toast, when there is no such table or pgfplots cannot draw it.
 */
export function chartTableAt(view: EditorView, at: number, kind?: TableChartKind): boolean {
  if (view.state.readOnly) return false;
  const span = findLatexTables(view.state.doc.toString()).find((s) => at >= s.from && at <= s.to);
  if (!span?.table || tableChartKinds(span.table).length === 0) return false;
  const id = newFigureId();
  const label = span.label ?? newTableLabel("latex", id);
  const model = readFigureModel(figureOfTable(span.table, label, id, kind));
  const drawn = model && picture(model, span.table);
  if (!model || !drawn) { showToast("pgfplots cannot draw this table (over 2000 rows, or bar names that are not plain ASCII).", "error"); return false; }
  const figure = `\n\n${formatFigureLines(model, drawn)}`;
  const line = span.label === null ? labelLine(span, label) : null;
  const changes: ChangeSpec[] = [...(line ? [{ from: line.at, insert: line.text }] : []), { from: span.to, insert: figure }];
  view.dispatch({ changes, selection: { anchor: span.to + (line?.text.length ?? 0) + 2 }, scrollIntoView: true, annotations: followed.of(true) });
  ensurePackage(view, "pgfplots");
  view.focus();
  return true;
}

/** The kinds the Chart menu of a source offers: the ones the table can make that pgfplots draws. */
const sourceKinds = (table: ChartTable): TableChartKind[] => tableChartKinds(table).filter((kind) => PGF_CHART_KINDS.has(kind));

/** The Chart button over the hovered table, or the table that holds the cursor while the editor has the focus. */
class TableButtonView {
  private spans: LatexTableSpan[];
  private hovered: LatexTableSpan | null = null;
  private readonly button: TableChartButton;
  private readonly onMove = (event: MouseEvent): void => {
    const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
    const next = pos === null ? null : this.spanAt(pos);
    if (next !== this.hovered) { this.hovered = next; this.button.place(); }
  };
  private readonly onLeave = (event: MouseEvent): void => {
    if (event.relatedTarget instanceof Node && this.button.element.contains(event.relatedTarget)) return;
    this.hovered = null;
    this.button.place();
  };

  constructor(private readonly view: EditorView) {
    this.spans = findLatexTables(view.state.doc.toString());
    this.button = mountTableChartButton({ dom: view.dom, target: () => this.target(), menu: () => this.menu(), leave: () => { this.hovered = null; this.button.place(); } });
    view.dom.addEventListener("mousemove", this.onMove);
    view.dom.addEventListener("mouseleave", this.onLeave);
  }

  private spanAt(pos: number): LatexTableSpan | null {
    const span = this.spans.find((s) => pos >= s.from && pos <= s.to);
    return span?.table && sourceKinds(span.table).length > 0 ? span : null;
  }

  private active(): LatexTableSpan | null {
    return activeBlock(this.view, this.hovered, (pos) => this.spanAt(pos));
  }

  /** The active table's box: from its first line to its last, across the text column. */
  private target(): TableChartTarget | null {
    const span = this.active();
    const rect = span && blockBox(this.view, span);
    return rect ? { rect, inset: 8 } : null;
  }

  private menu(): MenuEntry[] {
    const span = this.active();
    return span ? sourceKinds(span.table!).map((kind, i) => ({
      label: TABLE_CHART_LABELS[kind], icon: CHART_ICONS[kind], ...(i === 0 ? { hint: "Suggested" } : {}),
      onSelect: () => { chartTableAt(this.view, span.from, kind); },
    })) : [];
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) { this.spans = findLatexTables(update.state.doc.toString()); this.hovered = null; }
    remeasure(update, this, () => this.target(), (target) => this.button.place(target));
  }

  destroy(): void {
    this.view.dom.removeEventListener("mousemove", this.onMove);
    this.view.dom.removeEventListener("mouseleave", this.onLeave);
    this.button.destroy();
  }
}

/** The charts of a LaTeX source's tables: the follow of each linked figure and the Chart button over the tables. */
export const tableCharts: Extension = [linkedFigureSync, ViewPlugin.fromClass(TableButtonView)];
