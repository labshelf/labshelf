// Brings the figure editor to LaTeX sources: a figure is its picture (TikZ for a drawing, pgfplots for a plot or data figure)
// between two marker comments, the first carrying the model on one line so the figure opens again in the editor; the cursor
// inside one edits it, and the Edit figure button over the hovered figure, or the one holding the cursor, opens it.
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { formatTikz, isEmptyDrawingModel, layoutDrawing, parseDrawingModel, type DrawingModel } from "../../../drawing/index.js";
import { figureOfDrawing, readFigureModel, type FigureModel } from "../../../qmd/chart/index.js";
import { svgDimension } from "../../../qmd/dom/drawingEditor/index.js";
import { loadCoreMath, loadCorePlotly, loadFigureEditor } from "../../../qmd/dom/index.js";
import type { FigureEditorResult } from "../../../qmd/dom/figureEditor/index.js";
import { showToast } from "../../../ui/dom/index.js";
import { blockButton } from "./blockButton.js";

// A drawing keeps its own markers, which files written before plots and data figures already hold.
const MARKERS = [{ start: "% labshelf-drawing ", end: "% end labshelf-drawing" }, { start: "% labshelf-figure ", end: "% end labshelf-figure" }] as const;
const [DRAWING, FIGURE] = MARKERS;
const PACKAGES = { tikz: /\\usepackage(\[[^\]]*\])?\{[^}]*\b(tikz|pgfplots)\b[^}]*\}/, pgfplots: /\\usepackage(\[[^\]]*\])?\{[^}]*\bpgfplots\b[^}]*\}/ } as const;

interface FigureBlock { from: number; to: number; model: FigureModel }

/** The model on a start marker's line: a drawing's DrawingModel or another figure's FigureModel; null when unreadable. */
function readMarkerModel(marker: (typeof MARKERS)[number], json: string): FigureModel | null {
  if (marker === DRAWING) {
    const drawing = parseDrawingModel(json);
    return drawing ? figureOfDrawing(drawing, "00000000") : null;
  }
  try {
    return readFigureModel(JSON.parse(json));
  } catch {
    return null;
  }
}

/** The figure block whose lines hold `pos`, from its start marker to its end marker; null outside one or for an unreadable model. */
function findFigureBlock(view: EditorView, pos: number): FigureBlock | null {
  const { doc } = view.state;
  const here = doc.lineAt(pos).number;
  let start = 0;
  let marker: (typeof MARKERS)[number] | undefined;
  for (let n = here; n >= 1 && marker === undefined; n--) {
    const text = doc.line(n).text.trimStart();
    marker = MARKERS.find((m) => text.startsWith(m.start));
    if (marker) start = n;
    else if (MARKERS.some((m) => text.startsWith(m.end)) && n !== here) return null;
  }
  if (marker === undefined) return null;
  for (let n = start + 1; n <= doc.lines; n++) {
    if (!doc.line(n).text.trimStart().startsWith(marker.end)) continue;
    if (n < here) return null;
    const model = readMarkerModel(marker, doc.line(start).text.trimStart().slice(marker.start.length));
    return model ? { from: doc.line(start).from, to: doc.line(n).to, model } : null;
  }
  return null;
}

/** The spans of a text's figure blocks whose model reads, from each start marker's line start to its end marker's line end. */
export function findFigureSpans(text: string): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  let open: { from: number; marker: (typeof MARKERS)[number]; json: string } | null = null;
  let at = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trimStart();
    const marker = MARKERS.find((m) => trimmed.startsWith(m.start));
    if (marker) open = { from: at, marker, json: trimmed.slice(marker.start.length) };
    else if (open && trimmed.startsWith(open.marker.end)) {
      if (readMarkerModel(open.marker, open.json)) spans.push({ from: open.from, to: at + line.length });
      open = null;
    }
    at += line.length + 1;
  }
  return spans;
}

/** A drawing's block: the start marker with the drawing's model, the tikzpicture, the end marker. */
async function formatDrawingBlock(model: DrawingModel): Promise<string> {
  const math = await loadCoreMath();
  const measure = (tex: string): { width: number; height: number } => {
    const markup = math.renderMathSvg(tex, false);
    return { width: svgDimension(markup, "width"), height: svgDimension(markup, "height") };
  };
  return `${DRAWING.start}${JSON.stringify(model)}\n${formatTikz(model, layoutDrawing(model, measure)).trim()}\n${DRAWING.end}`;
}

/** Adds \usepackage{<name>} after the preamble's last package when the file has a preamble without it; a file with none relies on its main file. */
export function ensurePackage(view: EditorView, name: keyof typeof PACKAGES): void {
  const text = view.state.doc.toString();
  const documentClass = text.indexOf("\\documentclass");
  const begin = text.indexOf("\\begin{document}");
  if (documentClass < 0 || begin < 0 || PACKAGES[name].test(text.slice(0, begin))) return;
  const preamble = text.slice(0, begin);
  const lastPackage = preamble.lastIndexOf("\\usepackage");
  const after = view.state.doc.lineAt(lastPackage >= 0 ? lastPackage : documentClass).to;
  view.dispatch({ changes: { from: after, insert: `\n\\usepackage{${name}}` } });
  showToast(`Added \\usepackage{${name}} to the preamble for the figure.`, "info");
}

/** A plot's or data figure's block: the start marker with the model, the pgfplots picture, the end marker. */
export const formatFigureLines = (model: FigureModel, picture: string): string => `${FIGURE.start}${JSON.stringify(model)}\n${picture.trim()}\n${FIGURE.end}`;

/** A figure with nothing to draw: an empty drawing, a plot without functions, a data figure without series. */
function isEmptyFigure(model: FigureModel): boolean {
  if (model.kind === "drawing") return model.drawing === undefined || isEmptyDrawingModel(model.drawing);
  return model.kind === "plot" ? model.fns.length === 0 : model.traces.length === 0;
}

/** Writes the editor's result: a new figure at the cursor's line, the edited one in place, or an emptied one removed. */
async function commit(view: EditorView, block: FigureBlock | null, result: FigureEditorResult): Promise<void> {
  const { model } = result;
  if (isEmptyFigure(model)) {
    if (block) {
      const { doc } = view.state;
      const to = block.to < doc.length ? block.to + 1 : block.to;
      view.dispatch({ changes: { from: block.from, to } });
    }
    return;
  }
  if (model.kind !== "drawing" && result.picture === null) {
    showToast("This figure has no pgfplots form (several panels, or a table over 2000 rows), so it cannot be written to LaTeX.", "error");
    return;
  }
  const text = model.kind === "drawing" ? await formatDrawingBlock(model.drawing!) : formatFigureLines(model, result.picture!);
  if (block) {
    view.dispatch({ changes: { from: block.from, to: block.to, insert: text } });
  } else {
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const blank = line.text.trim() === "";
    view.dispatch({ changes: blank ? { from: line.from, to: line.to, insert: text } : { from: line.to, insert: `\n${text}` } });
  }
  ensurePackage(view, model.kind === "drawing" ? "tikz" : "pgfplots");
}

let opening = false;

/**
 * Opens the figure editor over the source editor on the figure at the cursor, or on the chooser of a new one (drawing,
 * functions or data); Done writes a drawing as TikZ and a plot or data figure as pgfplots. LaTeX only: Typst has neither.
 */
export async function editDrawingAtCursor(view: EditorView, language: "latex" | "typst", at = view.state.selection.main.head): Promise<void> {
  if (language !== "latex") { showToast("Figures can be drawn in LaTeX files.", "info"); return; }
  if (view.state.readOnly || opening) return;
  opening = true;
  const block = findFigureBlock(view, at);
  try {
    const editor = await loadFigureEditor();
    editor.openFigureEditor({
      model: block?.model ?? null,
      place: "Source",
      loadPlotly: loadCorePlotly,
      loadMath: loadCoreMath,
      done: (result) => {
        view.focus();
        if (!result) return;
        // Each write finds the figure again: an earlier write in this session moved or created it.
        void commit(view, findFigureBlock(view, block?.from ?? at), result).catch((error: unknown) => showToast(`Could not save the figure: ${error instanceof Error ? error.message : String(error)}`, "error"));
      },
    });
  } catch (error) {
    showToast(`Could not open the figure editor: ${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    opening = false;
  }
}

/** The Edit figure button over a LaTeX source's figure blocks. */
export const figureEditButton: Extension = blockButton({
  className: "ls-figure-edit", label: "Edit figure", title: "Open in the figure editor", icon: "edit",
  spans: findFigureSpans, run: (view, span) => void editDrawingAtCursor(view, "latex", span.from),
});
