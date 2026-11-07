// Writes a cell's run result into its item body as the output block right after the cell.
// CONTRACT: documents/contracts/qmd-items.md#outputs
import { deriveCodeHash, extractLineContent, extractLineEnding, findCellFences, findOutputs, formatOutput, formatOutputParams, isBlankLine, pngOutput, splitLines } from "../item/index.js";
import type { CellParamValue } from "../item/index.js";
import type { CellResult } from "./cellRunner.js";
import { plotAlt, plotContent } from "./plotContent.js";

interface CellLocation {
  readonly open: number;
  readonly close: number;
  /** The cell has no `#| label:` line and is addressed as `cell-<n>`. */
  readonly unlabeled: boolean;
}

/**
 * Returns `body` with the result's output block inserted after the cell labelled `cellLabel`, or replacing that
 * cell's existing block. An unlabeled cell is addressed as `cell-<n>` (1-based) and gets that label written.
 * Cancelled and missing results, and a label no cell has, return `body` unchanged.
 */
export async function writeCellOutput(body: string, cellLabel: string, result: CellResult, meta: { ran: string; params?: Record<string, CellParamValue> }): Promise<string> {
  if (result.status === "cancelled" || result.status === "missing") { return body; }
  const lines = splitLines(body);
  const cell = findCell(lines, cellLabel);
  if (!cell) { return body; }
  const eol = extractLineEnding(body);
  const code = lines.slice(cell.open + 1, cell.close).join("");
  const error = result.status === "error" || result.status === "timeout";
  const block = formatOutput({
    cell: cellLabel,
    source: await deriveCodeHash(code),
    engine: result.language,
    ran: meta.ran,
    ...(meta.params && Object.keys(meta.params).length > 0 ? { params: formatOutputParams(meta.params) } : {}),
    content: formatContent(result),
    ...(error ? { status: "error" as const } : {}),
  }, eol);

  // The cell's own block right under it is the one a rerun replaces, before any other block that names the label.
  const outputs = findOutputs(body);
  const after = offsetOfLine(lines, nextContentLine(lines, cell.close + 1));
  const existing = outputs.find((output) => output.start === after && output.cell === cellLabel) ?? outputs.find((output) => output.cell === cellLabel);
  const labelLine = cell.unlabeled ? `#| label: ${cellLabel}${eol}` : "";
  const openEnd = offsetOfLine(lines, cell.open + 1);
  if (existing) {
    const labeled = body.slice(0, openEnd) + labelLine + body.slice(openEnd);
    const shift = existing.start >= openEnd ? labelLine.length : 0;
    return labeled.slice(0, existing.start + shift) + block + labeled.slice(existing.end + shift);
  }
  const closeLine = lines[cell.close]!;
  const closeEnd = offsetOfLine(lines, cell.close + 1);
  const separator = closeLine === extractLineContent(closeLine) ? eol : "";
  return body.slice(0, openEnd) + labelLine + body.slice(openEnd, closeEnd) + separator + block + body.slice(closeEnd);
}

function formatContent(result: CellResult): string {
  if (result.status === "error" || result.status === "timeout") {
    const fallback = result.status === "timeout" ? `timed out after ${Math.round(result.durationMs / 1000)} s` : "";
    return fenced(result.error ?? fallback);
  }
  if (result.latex !== undefined) { return `$$ ${result.latex} $$\n`; }
  const plot = plotContent(result);
  if (plot !== null) { return plot; }
  const image = result.text && pngOutput(result.text);
  if (image) { return `![${plotAlt(result)}](${image})\n`; }
  return result.text === undefined ? "" : fenced(result.text);
}

function fenced(text: string): string {
  return "```\n" + text.replace(/(?:\r\n|\n|\r)$/, "") + "\n```\n";
}

/** The cell labelled `label`, or the unlabeled n-th cell when `label` is `cell-<n>`; raw-format fences and fences inside divs are not cells. */
function findCell(lines: readonly string[], label: string): CellLocation | undefined {
  const cells = findCellFences(lines);
  const own = cells.find((cell) => cell.label === label);
  if (own) { return { open: own.open, close: own.close, unlabeled: false }; }
  const nth = cells.find((cell) => cell.label === undefined && label === `cell-${cell.position}`);
  return nth && { open: nth.open, close: nth.close, unlabeled: true };
}

/** The first non-blank line from `line` on. */
function nextContentLine(lines: readonly string[], line: number): number {
  let next = line;
  while (next < lines.length && isBlankLine(lines[next]!)) { next++; }
  return next;
}

function offsetOfLine(lines: readonly string[], line: number): number {
  let offset = 0;
  for (let i = 0; i < line; i++) { offset += lines[i]!.length; }
  return offset;
}
