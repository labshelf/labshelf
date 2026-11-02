// What other folders use of the chart editor: a loader for its chunk, so that viewing a note never pulls the editor in, and the Plotly API type it calls.
export type { EditorPlotly } from "./editorPlotly.js";

/** Loads the chart editor chunk (`@labshelf/core/chartEditor`) the first time a chart is opened. */
export function loadChartEditor(): Promise<typeof import("./openChartEditor.js")> {
  return import("./openChartEditor.js");
}
