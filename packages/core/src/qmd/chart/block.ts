// The stored chart block: a labshelf-chart div holding an optional guarded pgfplots picture around the optional PNG line, then the model; reads exactly that div and writes it under a 256 KB cap.
// CONTRACT: documents/contracts/qmd-items.md#charts
import { CLOSE_DIV, escapeAlt, FENCE, FI, GUARD_CLOSE, LATEX_FENCE, openDiv, sha256Hex, unescapeAlt, utf8Bytes } from "../drawing/index.js";
import { readChartModel } from "./model.js";

export interface ChartBlock { model: import('./model.js').ChartModel; png: { dataUrl: string; widthCm: number; alt: string } | null; pgf: string | null; handEdited: boolean }

/** The most UTF-8 bytes a chart block may take. */
const CHART_BLOCK_BYTES = 262144;

const MODEL_FENCE = "```{=labshelf-chart}";
const GUARD_OPEN = "\\makeatletter\\@ifundefined{pgfplotsset}{\\iftrue}{";
const OPENER = /^::: \{\.labshelf-chart source=([^\s{}]+)\}$/;
const IMAGE = /^!\[\]\((data:image\/png;base64,[A-Za-z0-9+/]*={0,2})\)\{width=(\d+(?:\.\d+)?)cm fig-alt="((?:[^"\\]|\\.)*)"\}$/;

/** The first 12 hex characters of the SHA-256 of the text. */
function sourceHash(text: string): string {
  return sha256Hex(text).slice(0, 12);
}

/** Reads a chart block: exactly one labshelf-chart div with its parts in the order of the contract (\n or \r\n, blank lines between parts); null for anything else, an invalid model or a block over the cap. */
export function readChartBlock(raw: string): ChartBlock | null {
  if (utf8Bytes(raw) > CHART_BLOCK_BYTES) { return null; }
  const div = openDiv(raw, OPENER);
  if (!div) { return null; }
  const { opener, parts } = div;
  let pgf: string | null = null;
  if (parts.peek() === LATEX_FENCE) {
    const guard = parts.fence(LATEX_FENCE);
    if (guard === null || !guard.startsWith(GUARD_OPEN) || !guard.endsWith(GUARD_CLOSE)) { return null; }
    pgf = guard.slice(GUARD_OPEN.length, guard.length - GUARD_CLOSE.length);
  }
  const image = IMAGE.exec(parts.peek() ?? "");
  if (image) { parts.line(); }
  if (pgf !== null && parts.fence(LATEX_FENCE) !== FI) { return null; }
  const json = parts.fence(MODEL_FENCE);
  if (json === null || json.includes("\n") || !parts.done()) { return null; }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  const model = readChartModel(value);
  if (!model) { return null; }
  const png = image ? { dataUrl: image[1]!, widthCm: Number(image[2]), alt: unescapeAlt(image[3]!) } : null;
  return { model, png, pgf, handEdited: opener[1] !== sourceHash(pgf ?? json) };
}

/** Writes the chart block with the given line ending (\n by default): the model in canonical form, source from the pgfplots part when present, else from the model JSON; null when the model is invalid, a part would break the block, or it exceeds 262144 UTF-8 bytes. */
export function formatChartBlock(block: Omit<ChartBlock, 'handEdited'>, eol: '\n' | '\r\n' = "\n"): string | null {
  const model = readChartModel(block.model);
  if (!model) { return null; }
  const json = JSON.stringify(model);
  const pgf = block.pgf === null ? null : block.pgf.replace(/\r\n?/g, "\n");
  if (pgf !== null && pgf.split("\n").includes(FENCE)) { return null; }
  const parts: string[][] = [];
  if (pgf !== null) { parts.push([LATEX_FENCE, `${GUARD_OPEN}${pgf}${GUARD_CLOSE}`, FENCE]); }
  if (block.png !== null) {
    const { dataUrl, widthCm, alt } = block.png;
    if (!Number.isFinite(widthCm) || widthCm <= 0) { return null; }
    const line = `![](${dataUrl}){width=${widthCm}cm fig-alt="${escapeAlt(alt)}"}`;
    if (!IMAGE.test(line)) { return null; }
    parts.push([line]);
  }
  if (pgf !== null) { parts.push([LATEX_FENCE, FI, FENCE]); }
  parts.push([MODEL_FENCE, json, FENCE]);
  const text = [
    `::: {.labshelf-chart source=${sourceHash(pgf ?? json)}}`,
    parts.map((p) => p.join("\n")).join("\n\n"),
    CLOSE_DIV,
  ].join("\n");
  const out = eol === "\n" ? text : text.replace(/\n/g, eol);
  return utf8Bytes(out) > CHART_BLOCK_BYTES ? null : out;
}
