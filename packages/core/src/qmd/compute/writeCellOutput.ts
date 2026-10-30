// Writes a cell's run result into its item body as the output block right after the cell.
// CONTRACT: documents/contracts/qmd-items.md#outputs
import { deriveCodeHash, extractLineContent, extractLineEnding, findCodeFences, findOutputs, formatOutput, pngOutput, splitLines } from "../item/index.js";
import type { CellResult } from "./cellRunner.js";

const LABEL = /^#\|[ \t]*label:[ \t]*(.*?)[ \t]*$/;

interface CellLocation {
  readonly open: number;
  readonly close: number;
  /** The cell has no `#| label:` line and is addressed as `cell-<n>`. */
  readonly unlabeled: boolean;
}

/**
 * Returns `body` with the result's output block inserted after the cell labelled `cellLabel`, or replacing that
 * cell's existing block. An unlabeled cell is addressed as `cell-<n>` (1-based) and gets that label written.
 * Cancelled and missing-python results, and a label no cell has, return `body` unchanged.
 */
export async function writeCellOutput(body: string, cellLabel: string, result: CellResult, meta: { engine: string; ran: string }): Promise<string> {
  if (result.status === "cancelled" || result.status === "missing-python") { return body; }
  const lines = splitLines(body);
  const cell = findCell(lines, body, cellLabel);
  if (!cell) { return body; }
  const eol = extractLineEnding(body);
  const code = lines.slice(cell.open + 1, cell.close).join("");
  const error = result.status === "error" || result.status === "timeout";
  const block = formatOutput({
    cell: cellLabel,
    source: await deriveCodeHash(code),
    engine: meta.engine,
    ran: meta.ran,
    content: formatContent(result),
    ...(error ? { status: "error" as const } : {}),
  }, eol);

  const existing = findOutputs(body).find((output) => output.cell === cellLabel);
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
  const image = result.text && pngOutput(result.text);
  if (image) { return `![Python plot](${image})\n`; }
  return result.text === undefined ? "" : fenced(result.text);
}

function fenced(text: string): string {
  return "```\n" + text.replace(/(?:\r\n|\n|\r)$/, "") + "\n```\n";
}

/** The cell labelled `label`, or the unlabeled n-th cell when `label` is `cell-<n>`. Fences inside output blocks are not cells. */
function findCell(lines: readonly string[], body: string, label: string): CellLocation | undefined {
  const outputs = findOutputs(body);
  const insideOutput = (line: number): boolean => {
    const offset = offsetOfLine(lines, line);
    return outputs.some((output) => offset >= output.start && offset < output.end);
  };
  let position = 0;
  let unlabeledMatch: CellLocation | undefined;
  for (const [open, close] of findCodeFences(lines)) {
    if (insideOutput(open)) { continue; }
    position++;
    const own = lines.slice(open + 1, close).map((line) => LABEL.exec(extractLineContent(line))?.[1]).find((value) => value !== undefined);
    if (own === label) { return { open, close, unlabeled: false }; }
    if (own === undefined && label === `cell-${position}` && !unlabeledMatch) { unlabeledMatch = { open, close, unlabeled: true }; }
  }
  return unlabeledMatch;
}

function offsetOfLine(lines: readonly string[], line: number): number {
  let offset = 0;
  for (let i = 0; i < line; i++) { offset += lines[i]!.length; }
  return offset;
}
