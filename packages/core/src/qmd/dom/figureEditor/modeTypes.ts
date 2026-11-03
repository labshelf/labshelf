// What a mode of the figure editor (drawing, functions, data) is given and gives back: the shell to fill, the figure as it
// stands, the change that marks it edited, and the parts its write stores.
import type { WsShell } from "../../../ui/dom/index.js";
import type { ChartTable, FigureModel } from "../../chart/index.js";
import type { FigureEditorHost, FigureEditorResult } from "./index.js";

export interface ModeContext {
  shell: WsShell;
  host: FigureEditorHost;
  /** The figure as it stands. */
  model(): FigureModel;
  /** Records an edit: the figure becomes `next` and the editor shows unsaved changes. */
  change(next: FigureModel): void;
  /** The table of a data figure whose rows are in its CSV (`src`), null when it was not read. */
  table: ChartTable | null;
}

export interface FigureMode {
  /** The figure's write: the model as stored (a large table moved to its CSV) and its PNG, guarded picture and SVG; null after showing why it could not be made. */
  parts(model: FigureModel): Promise<FigureEditorResult | null>;
  /** The text the Code view shows: TikZ, pgfplots or the model. */
  code(model: FigureModel): Promise<string>;
  destroy(): void;
}

export type ModeFactory = (ctx: ModeContext) => FigureMode;
