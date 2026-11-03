// The part of the plotly.js API the chart editor calls; the note's Plotly loader (`PlotlyLoader` of plotView.ts) returns a
// larger API that extends it, so the editor chunk never imports the note's view code.

export interface EditorPlotly {
  react(root: HTMLElement, data: readonly object[], layout?: object, config?: object): Promise<unknown>;
  purge(root: HTMLElement): void;
  relayout(root: HTMLElement, update: object): Promise<unknown>;
  /** A data URL of the drawn plot at `width` x `height` CSS px times `scale`. */
  toImage(root: HTMLElement, options: { format: "png"; width: number; height: number; scale: number }): Promise<string>;
}

export type EditorPlotlyLoader = () => Promise<EditorPlotly>;
