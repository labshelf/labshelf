// The stored content of a cell result that carries a plot spec: the PNG line followed by the labshelf-plot fence.
// CONTRACT: documents/contracts/qmd-items.md#outputs
import { formatPlotContent, parsePlotSpec, pngOutput } from "../item/index.js";
import { cellLanguageLabel } from "./cellLanguage.js";
import type { CellResult } from "./cellRunner.js";

/** The alt text of a plot image written for `result`: the cell's language, then "plot" ("R plot"). */
export function plotAlt(result: CellResult): string {
  return `${cellLanguageLabel(result.language)} plot`;
}

/** The content for a non-error result whose `plot` parses to a spec (the PNG in `text` is kept as the image); null otherwise. */
export function plotContent(result: CellResult): string | null {
  if (result.status === "error" || result.status === "timeout" || typeof result.plot !== "string") { return null; }
  const spec = parsePlotSpec(result.plot);
  if (!spec) { return null; }
  const src = result.text ? pngOutput(result.text) : null;
  return formatPlotContent(src ? { alt: plotAlt(result), src } : null, spec);
}
