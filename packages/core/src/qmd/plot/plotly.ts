/**
 * The plotly.js strict bundle (no `eval`, no `new Function`), behind the minimal API core's plot renderer uses.
 * This is the only module that imports the library; hosts reach it as `@labshelf/core/plot-renderer`.
 * TRAP: it is about 5 MB of minified UMD with import-time side effects (it injects a <style> element); only ever import
 * this module lazily (`import("../plot/plotly.js")`), never statically.
 */
// @ts-expect-error the package ships no types; PlotlyApi below names the part core uses.
import PlotlyModule from "plotly.js-strict-dist-min";

/** The part of the plotly.js API core calls. */
export interface PlotlyApi {
  react(root: HTMLElement, data: readonly object[], layout?: object, config?: object): Promise<unknown>;
  purge(root: HTMLElement): void;
  Plots: { resize(root: HTMLElement): unknown };
}

export const Plotly: PlotlyApi = PlotlyModule as PlotlyApi;
