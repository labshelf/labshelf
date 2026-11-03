// What other folders use of the chart editor: a loader for its chunk, so that viewing a note never pulls the editor in, the Plotly API type it calls and the note files port it needs.
export type { EditorPlotly } from "./editorPlotly.js";

/** The note files the editor uses (a NoteFilesPort fits it): the write of a large table's CSV and the pick of a file to import. Declared here so the editor does not reach back into qmd/. */
export interface ChartEditorFiles { write(path: string, bytes: Uint8Array): Promise<void>; pickTextFile(accept: readonly string[]): Promise<{ name: string; text: string } | null> }

/** Loads the chart editor chunk (`@labshelf/core/chartEditor`) the first time a chart is opened. */
export function loadChartEditor(): Promise<typeof import("./openChartEditor.js")> {
  return import("./openChartEditor.js");
}
