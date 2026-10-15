/** Finds where a citation key is being typed, so an editor can offer library papers there. */

import type { ProjectFormat } from "../project/index.js";
import { LATEX_CITE_COMMAND } from "./citationKeys.js";

const LATEX_OPEN_CITE = new RegExp(`${LATEX_CITE_COMMAND}[^}]*$`);
const TYPST_OPEN_REFERENCE = /(?<![\p{L}\p{N}_])@[\p{L}\p{N}_:.-]*$/u;
const TYPST_OPEN_CITE = /#cite\(\s*<[^>\s]*$/;

/** Column where the partial key before the cursor starts, or undefined when the cursor is not in a citation. */
export function partialKeyStart(format: ProjectFormat, linePrefix: string): number | undefined {
  if (format === "latex") {
    if (!LATEX_OPEN_CITE.test(linePrefix)) { return undefined; }
    let start = Math.max(linePrefix.lastIndexOf("{"), linePrefix.lastIndexOf(",")) + 1;
    while (linePrefix[start] === " ") { start += 1; }
    return start;
  }
  const open = TYPST_OPEN_REFERENCE.exec(linePrefix) ?? TYPST_OPEN_CITE.exec(linePrefix);
  if (!open) { return undefined; }
  return open.index + open[0].search(/[@<]/) + 1;
}
