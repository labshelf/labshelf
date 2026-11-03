// What other folders use of the figure editor: a loader for its chunk, so that viewing a note never pulls the editor in, the
// Plotly API type it calls, the note files it needs and the shape of what it writes.
import type { ChartTable, FigureKind, FigureModel, FigurePng } from "../../chart/index.js";
import type { MathLoader } from "../mathView.js";
import type { EditorPlotlyLoader } from "./editorPlotly.js";

export type { EditorPlotly } from "./editorPlotly.js";

/** The note files the editor uses (a NoteFilesPort fits it): the write of a large table's CSV and the pick of a file to import. Declared here so the editor does not reach back into qmd/. */
export interface FigureEditorFiles { write(path: string, bytes: Uint8Array): Promise<void>; pickTextFile(accept: readonly string[]): Promise<{ name: string; text: string } | null> }

/** One write of the editor: the model, its PNG, the picture its LaTeX guard holds (TikZ or pgfplots, null for none) and a drawing's SVG. */
export interface FigureEditorResult { model: FigureModel; png: FigurePng | null; picture: string | null; svg: string | null }

/**
 * What the note gives the editor; `done` gets each write (Apply, Done) and null when the editor closes without writing.
 * For a data figure with `src`, `table` is the CSV the note read, or `missing` the note shown when it could not (the table is then read-only).
 */
export interface FigureEditorHost {
  model: FigureModel | null;
  loadPlotly: EditorPlotlyLoader;
  loadMath: MathLoader;
  files?: FigureEditorFiles;
  table?: ChartTable;
  missing?: string;
  /** The kinds a new figure may be; with one, the editor opens on it without the chooser. All three when absent. */
  kinds?: readonly FigureKind[];
  /** The breadcrumb's first part and the back button's place, "Note" when absent. */
  place?: string;
  done(result: FigureEditorResult | null): void;
}

/** Loads the figure editor chunk (`@labshelf/core/figureEditor`) the first time a figure is opened. */
export function loadFigureEditor(): Promise<typeof import("./openFigureEditor.js")> {
  return import("./openFigureEditor.js");
}
