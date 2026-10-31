// Finds and writes the output blocks that hold a code cell's stored result inside an item body, and hashes the code they date.
// CONTRACT: documents/contracts/qmd-items.md#outputs
import { deriveTextSha256Hex } from "../../hash/index.js";
import { formatPlotSpec, parsePlotSpec, type PlotSpec } from "../plot/plotSpec.js";
import { readAttribute, formatDivOpener, isBalanced, extractLineContent, parseDivOpener, splitLines, findTopLevelDivs } from "./itemFile.js";

export const OUTPUT_CLASS = "labshelf-output";

export interface CellOutputBlock {
  /** The label of the cell the result belongs to. */
  readonly cell: string;
  readonly source: string;
  readonly engine?: string;
  readonly ran?: string;
  /** The raw `params` attribute: the parameter values the result was made with; see `isOutputParamsStale`. */
  readonly params?: string;
  /** The result's Markdown, the bytes between the block's fences. */
  readonly content: string;
  /** UTF-16 offsets of the whole block in the body, from its opening line to after its closing line. */
  readonly start: number;
  readonly end: number;
}

export interface CreateOutputInput {
  readonly cell: string;
  readonly source: string;
  readonly engine: string;
  readonly ran: string;
  /** Written as the `params` attribute (see `formatOutputParams`) when the cell has parameters. */
  readonly params?: string;
  readonly content: string;
  /** Written as the opener's last attribute; an ok result has none. */
  readonly status?: "error";
}

/** Output blocks at the top level of `body`; a block without `cell` or `source` is text, not an output. */
export function findOutputs(body: string): CellOutputBlock[] {
  const lines = splitLines(body);
  const offsets = [0];
  for (const line of lines) { offsets.push(offsets.at(-1)! + line.length); }
  const outputs: CellOutputBlock[] = [];
  for (const { open, close } of findTopLevelDivs(lines)) {
    const attributes = parseDivOpener(extractLineContent(lines[open]!));
    if (!attributes?.classes.includes(OUTPUT_CLASS)) { continue; }
    const cell = readAttribute(attributes, "cell");
    const source = readAttribute(attributes, "source");
    if (!cell || !source) { continue; }
    const engine = readAttribute(attributes, "engine");
    const ran = readAttribute(attributes, "ran");
    const params = readAttribute(attributes, "params");
    outputs.push({
      cell,
      source,
      ...(engine === undefined ? {} : { engine }),
      ...(ran === undefined ? {} : { ran }),
      ...(params === undefined ? {} : { params }),
      content: lines.slice(open + 1, close).join(""),
      start: offsets[open]!,
      end: offsets[close + 1]!,
    });
  }
  return outputs;
}

/** Writes a whole output block, ending with `eol`. Throws when the content would end the block early. */
export function formatOutput(output: CreateOutputInput, eol = "\n"): string {
  const opener = formatDivOpener({
    classes: [OUTPUT_CLASS],
    pairs: [
      ["cell", output.cell], ["source", output.source], ["engine", output.engine], ["ran", output.ran],
      ...(output.params === undefined ? [] : [["params", output.params] as [string, string]]),
      ...(output.status === undefined ? [] : [["status", output.status] as [string, string]]),
    ],
  });
  const content = output.content.replace(/\r\n|\n|\r/g, eol);
  const ended = content === "" || content.endsWith(eol) ? content : content + eol;
  if (!isBalanced(splitLines(ended))) { throw new Error(`Output of cell ${output.cell}: content opens or closes a div it does not close or open`); }
  return `${opener}${eol}${ended}:::${eol}`;
}

const SOURCE_LENGTH = 12;

/** `code` is the text between the cell's fences; `#|` option lines and line endings do not change the hash. */
export async function deriveCodeHash(code: string): Promise<string> {
  const lines = code.split(/\r\n|\n|\r/).filter((line) => !line.startsWith("#|"));
  const normalized = lines.join("\n").replace(/\n+$/, "");
  return (await deriveTextSha256Hex(normalized)).slice(0, SOURCE_LENGTH);
}

/** Accepts an embedded PNG returned by a Python cell; active image formats and remote URLs are excluded. */
export function pngOutput(text: string): string | null {
  return /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(text) ? text : null;
}

export interface OutputImage { alt: string; src: string }

/** Opens the raw block that carries a plot's spec JSON after its PNG; Pandoc and Quarto skip the `labshelf-plot` format. */
export const PLOT_FENCE = "```{=labshelf-plot}";
const FENCE_CLOSE = "```";

function readImageLine(line: string): OutputImage | null {
  const match = /^!\[([^\]\r\n]*)\]\(([^\r\n]+)\)$/.exec(line);
  const src = match && pngOutput(match[2] ?? "");
  return src ? { alt: match![1] || "Python plot", src } : null;
}

/** The content's non-blank lines, trimmed. */
function contentLines(markdown: string): string[] {
  return markdown.split(/\r\n|\n|\r/).map((line) => line.trim()).filter((line) => line !== "");
}

/** Splits `[image] PLOT_FENCE body… closing` lines into the image and the fence body; null when the lines are anything else. */
function splitPlotLines(lines: string[]): { image: OutputImage | null; body: string[] } | null {
  const image = lines.length > 0 ? readImageLine(lines[0]!) : null;
  const rest = image ? lines.slice(1) : lines;
  if (rest.length < 2 || rest[0] !== PLOT_FENCE || rest.at(-1) !== FENCE_CLOSE) { return null; }
  const body = rest.slice(1, -1);
  return body.includes(FENCE_CLOSE) ? null : { image, body };
}

/** Reads the single embedded image of a stored plot result, alone or followed by a plot fence whose spec may be missing or bad. */
export function readOutputImage(markdown: string): OutputImage | null {
  const lines = contentLines(markdown);
  if (lines.length === 1) { return readImageLine(lines[0]!); }
  return splitPlotLines(lines)?.image ?? null;
}

/** Writes a plot result: the PNG line, a blank line, then the spec on one line in a plot fence. A spec over the size cap is dropped and the PNG kept. */
export function formatPlotContent(image: OutputImage | null, spec: PlotSpec): string {
  const imageLine = image ? `![${image.alt}](${image.src})\n` : "";
  const json = formatPlotSpec(spec);
  if (json === null) { return imageLine; }
  return `${imageLine}${image ? "\n" : ""}${PLOT_FENCE}\n${json}\n${FENCE_CLOSE}\n`;
}

/** Reads a plot result written by `formatPlotContent`; null when the content holds anything else or the spec is invalid. */
export function readOutputPlot(markdown: string): { image: OutputImage | null; spec: PlotSpec } | null {
  const parts = splitPlotLines(contentLines(markdown));
  if (!parts || parts.body.length !== 1) { return null; }
  const spec = parsePlotSpec(parts.body[0]!);
  return spec ? { image: parts.image, spec } : null;
}
