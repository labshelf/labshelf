// Charts of the tables of a LaTeX source: Chart from Table writes a data figure (pgfplots) after the table at the cursor, which
// follows the table through its `\label` (one is added when the table has none); every edit of the text rewrites each such
// figure whose table changed, in the same transaction, so one undo takes back both.
// CONTRACT: documents/contracts/qmd-items.md#figures
import { Annotation, EditorState, Transaction, type AnnotationType, type ChangeSpec, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { ySyncAnnotation } from "y-codemirror.next";
import { findLatexTables, figureOfTable, formatChartPgf, labelLine, sameTable, newFigureId, newTableLabel, readFigureModel, type ChartTable, type FigureModel } from "../../../qmd/chart/index.js";
import { showToast } from "../../../ui/dom/index.js";
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
export const linkedFigureSync: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(followed) || tr.annotation(fromDisk) || tr.annotation(Transaction.remote) || tr.annotation(peerEdit) !== undefined) return tr;
  const text = tr.newDoc.toString();
  if (!text.includes(START)) return tr;
  const changes = linkedFigureEdits(text);
  return changes.length === 0 ? tr : [tr, { changes, sequential: true, annotations: followed.of(true) }];
});

/**
 * Chart from Table: a data figure of the table at the cursor after it, its series the first column against each other column
 * of numbers, and a `\label` on the table when it has none. LaTeX only, as Typst has no figure form.
 */
export function chartTableAtCursor(view: EditorView, language: "latex" | "typst"): void {
  if (language !== "latex") { showToast("Charts of tables can be made in LaTeX files.", "info"); return; }
  if (view.state.readOnly) return;
  const head = view.state.selection.main.head;
  const span = findLatexTables(view.state.doc.toString()).find((s) => head >= s.from && head <= s.to);
  if (!span) { showToast("Put the cursor in a table to chart it.", "info"); return; }
  if (!span.table) { showToast("This table could not be read.", "error"); return; }
  const id = newFigureId();
  const label = span.label ?? newTableLabel("latex", id);
  const model = readFigureModel(figureOfTable(span.table, label, id));
  if (!model || model.traces.length === 0) { showToast("The table has no column of numbers to chart.", "info"); return; }
  const drawn = picture(model, span.table);
  if (drawn === null) { showToast("pgfplots cannot draw this table (over 2000 rows, or bar names that are not plain ASCII).", "error"); return; }
  const figure = `\n\n${formatFigureLines(model, drawn)}`;
  const line = span.label === null ? labelLine(span, label) : null;
  const changes: ChangeSpec[] = [...(line ? [{ from: line.at, insert: line.text }] : []), { from: span.to, insert: figure }];
  view.dispatch({ changes, selection: { anchor: span.to + (line?.text.length ?? 0) + 2 }, scrollIntoView: true, annotations: followed.of(true) });
  ensurePackage(view, "pgfplots");
  view.focus();
}
