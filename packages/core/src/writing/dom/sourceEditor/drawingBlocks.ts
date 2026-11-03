// Brings the figure editor's drawing mode to LaTeX sources: a diagram is a tikzpicture between two marker comments, the first
// carrying the drawing's model on one line so the diagram opens again in the editor; the cursor inside one edits it.
import type { EditorView } from "@codemirror/view";
import { formatTikz, isEmptyDrawingModel, layoutDrawing, parseDrawingModel, type DrawingModel } from "../../../drawing/index.js";
import { figureOfDrawing } from "../../../qmd/chart/index.js";
import { svgDimension } from "../../../qmd/dom/drawingEditor/index.js";
import { loadCoreMath, loadCorePlotly, loadFigureEditor } from "../../../qmd/dom/index.js";
import { showToast } from "../../../ui/dom/index.js";

const START = "% labshelf-drawing ";
const END = "% end labshelf-drawing";
const TIKZ_PACKAGE = /\\usepackage(\[[^\]]*\])?\{[^}]*\btikz\b[^}]*\}/;

interface DrawingBlock { from: number; to: number; model: DrawingModel }

/** The diagram block whose lines hold `pos`, from its start marker to its end marker; null outside one or for an unreadable model. */
function findDrawingBlock(view: EditorView, pos: number): DrawingBlock | null {
  const { doc } = view.state;
  const here = doc.lineAt(pos).number;
  let start = 0;
  for (let n = here; n >= 1; n--) {
    const text = doc.line(n).text.trimStart();
    if (text.startsWith(START)) { start = n; break; }
    if (text.startsWith(END) && n !== here) return null;
  }
  if (start === 0) return null;
  for (let n = start + 1; n <= doc.lines; n++) {
    if (!doc.line(n).text.trimStart().startsWith(END)) continue;
    if (n < here) return null;
    const model = parseDrawingModel(doc.line(start).text.trimStart().slice(START.length));
    return model ? { from: doc.line(start).from, to: doc.line(n).to, model } : null;
  }
  return null;
}

/** The block's text: the start marker with the model, the tikzpicture, the end marker. */
async function formatBlock(model: DrawingModel): Promise<string> {
  const math = await loadCoreMath();
  const measure = (tex: string): { width: number; height: number } => {
    const markup = math.renderMathSvg(tex, false);
    return { width: svgDimension(markup, "width"), height: svgDimension(markup, "height") };
  };
  return `${START}${JSON.stringify(model)}\n${formatTikz(model, layoutDrawing(model, measure)).trim()}\n${END}`;
}

/** Adds \usepackage{tikz} after the preamble's last package when the file has a preamble without it; a file with none relies on its main file. */
function ensureTikzPackage(view: EditorView): void {
  const text = view.state.doc.toString();
  const documentClass = text.indexOf("\\documentclass");
  const begin = text.indexOf("\\begin{document}");
  if (documentClass < 0 || begin < 0 || TIKZ_PACKAGE.test(text.slice(0, begin))) return;
  const preamble = text.slice(0, begin);
  const lastPackage = preamble.lastIndexOf("\\usepackage");
  const after = view.state.doc.lineAt(lastPackage >= 0 ? lastPackage : documentClass).to;
  view.dispatch({ changes: { from: after, insert: "\n\\usepackage{tikz}" } });
  showToast("Added \\usepackage{tikz} to the preamble for the diagram.", "info");
}

/** Writes the editor's result: a new diagram at the cursor's line, the edited one in place, or an emptied one removed. */
async function commit(view: EditorView, block: DrawingBlock | null, model: DrawingModel): Promise<void> {
  if (isEmptyDrawingModel(model)) {
    if (block) {
      const { doc } = view.state;
      const to = block.to < doc.length ? block.to + 1 : block.to;
      view.dispatch({ changes: { from: block.from, to } });
    }
    return;
  }
  const text = await formatBlock(model);
  if (block) {
    view.dispatch({ changes: { from: block.from, to: block.to, insert: text } });
  } else {
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const blank = line.text.trim() === "";
    view.dispatch({ changes: blank ? { from: line.from, to: line.to, insert: text } : { from: line.to, insert: `\n${text}` } });
  }
  ensureTikzPackage(view);
}

let opening = false;

/**
 * Opens the drawing editor over the source editor on the diagram at the cursor, or on an empty one to insert a new
 * diagram; Done writes it as TikZ. LaTeX only: Typst has no TikZ.
 */
export async function editDrawingAtCursor(view: EditorView, language: "latex" | "typst"): Promise<void> {
  if (language !== "latex") { showToast("Diagrams can be drawn in LaTeX files.", "info"); return; }
  if (view.state.readOnly || opening) return;
  opening = true;
  const at = view.state.selection.main.head;
  const block = findDrawingBlock(view, at);
  try {
    const editor = await loadFigureEditor();
    editor.openFigureEditor({
      model: block ? figureOfDrawing(block.model, "00000000") : null,
      kinds: ["drawing"],
      place: "Source",
      loadPlotly: loadCorePlotly,
      loadMath: loadCoreMath,
      done: (result) => {
        view.focus();
        const drawing = result?.model.drawing;
        if (!drawing) return;
        // Each write finds the diagram again: an earlier write in this session moved or created it.
        void commit(view, findDrawingBlock(view, block?.from ?? at), drawing).catch((error: unknown) => showToast(`Could not save the diagram: ${error instanceof Error ? error.message : String(error)}`, "error"));
      },
    });
  } catch (error) {
    showToast(`Could not open the diagram editor: ${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    opening = false;
  }
}
