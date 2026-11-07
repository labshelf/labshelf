// Finds and writes the output blocks that hold a code cell's stored result inside an item body, hashes the code they date,
// and reads and rewrites the `#| param:` lines of a code cell's options and the `params` attribute of its output block.
// CONTRACT: documents/contracts/qmd-items.md#outputs
// CONTRACT: documents/contracts/qmd-items.md#cell-parameters
import { deriveTextSha256Hex } from "../../hash/index.js";
import { formatPlotSpec, parsePlotSpec, type PlotSpec } from "./plotSpec.js";
import { readAttribute, formatDivOpener, isBalanced, extractLineContent, parseDivOpener, splitLines, findTopLevelDivs, findCodeFences } from "./itemFile.js";

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

const LABEL_LINE = /^#\|[ \t]*label:[ \t]*(.*?)[ \t]*$/;
/** The opener of a raw block of another format (```` ```{=latex} ````, ```` ```{=labshelf-svg} ````): never a code cell. */
const RAW_FENCE = /^ {0,3}(?:`{3,}|~{3,})[ \t]*\{=/;

/** A code cell of an item body by line index: its fences, its `#| label:` (undefined without one) and its 1-based position among the cells. */
export interface CellFence { readonly open: number; readonly close: number; readonly label: string | undefined; readonly position: number }

/** Whether `line` opens a raw block of another format rather than a code cell. */
export function isRawFenceOpener(line: string): boolean {
  return RAW_FENCE.test(line);
}

/** The code cells of `lines` in order, as the editor reads them: a raw-format fence and a fence inside a div (an output, a figure, a callout) are not cells. */
export function findCellFences(lines: readonly string[]): CellFence[] {
  const divs = findTopLevelDivs(lines);
  const cells: CellFence[] = [];
  for (const [open, close] of findCodeFences(lines)) {
    if (divs.some((div) => open > div.open && open < div.close) || isRawFenceOpener(extractLineContent(lines[open]!))) { continue; }
    const label = lines.slice(open + 1, close).map((line) => LABEL_LINE.exec(extractLineContent(line))?.[1]).find((value) => value !== undefined);
    cells.push({ open, close, label, position: cells.length + 1 });
  }
  return cells;
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

export { deriveResultSource } from "./deriveResultSource.js";

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

export type CellParamValue = number | string | boolean;

export type CellParam =
  | { name: string; kind: "slider"; min: number; max: number; step?: number; log?: boolean; value: number }
  | { name: string; kind: "select"; choices: (number | string)[]; value: number | string }
  | { name: string; kind: "checkbox"; value: boolean };

const MAX_PARAMS = 8;
const LINE = /^#\|[ \t]*param:[ \t]*([A-Za-z][A-Za-z0-9_]*)[ \t]*=[ \t]*(slider|select|checkbox)[ \t]*\((.*)\)[ \t]*$/;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const STRING = /^"((?:[^"\\]|\\.)*)"$/;

/** A trimmed piece of a line, with its offsets in the line. */
interface Piece { readonly text: string; readonly start: number; readonly end: number }

interface Located {
  readonly param: CellParam;
  /** Offsets of the value token in the options. */
  readonly valueStart: number;
  readonly valueEnd: number;
}

/** The params declared by the `#| param:` lines of `options`, in order; malformed lines, bad names and a 9th param are skipped. */
export function parseCellParams(options: string): CellParam[] {
  return locate(options).map((located) => located.param);
}

/** Rewrites the value token of the param `name` and nothing else; unknown names and malformed lines return `options`. */
export function setCellParamValue(options: string, name: string, value: CellParamValue): string {
  const found = locate(options).find((located) => located.param.name === name);
  if (!found) { return options; }
  const token = formatValueToken(found.param, value);
  if (token === undefined) { return options; }
  return options.slice(0, found.valueStart) + token + options.slice(found.valueEnd);
}

/** The `#| param:` line of `param`, without a line ending. */
export function formatCellParamLine(param: CellParam): string {
  const head = `#| param: ${param.name} = ${param.kind}`;
  if (param.kind === "checkbox") { return `${head}(${param.value})`; }
  if (param.kind === "select") { return `${head}(${param.choices.map(formatScalar).join(", ")}; ${formatScalar(param.value)})`; }
  const parts = [param.min, param.max, param.value].map(String);
  if (param.step !== undefined) { parts.push(`step = ${param.step}`); }
  if (param.log) { parts.push("log"); }
  return `${head}(${parts.join(", ")})`;
}

export function paramValues(params: CellParam[]): Record<string, CellParamValue> {
  return Object.fromEntries(params.map((param) => [param.name, param.value]));
}

/** The raw `params` attribute: names sorted, `name=value` joined by `;`, strings JSON-quoted. */
export function formatOutputParams(values: Record<string, CellParamValue>): string {
  return Object.keys(values).sort().map((name) => `${name}=${formatScalar(values[name]!)}`).join(";");
}

const MAX_REQUEST_STRING = 200;
const PARAM_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** The params of a run request: an object of at most 8 entries with named values (finite number, boolean or string up to 200 characters); undefined when `value` is anything else. */
export function readRequestParams(value: unknown): Record<string, CellParamValue> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) { return undefined; }
  const names = Object.keys(value);
  if (names.length > MAX_PARAMS) { return undefined; }
  const params: Record<string, CellParamValue> = {};
  for (const name of names) {
    const entry = (value as Record<string, unknown>)[name];
    const valid = typeof entry === "boolean"
      || (typeof entry === "number" && Number.isFinite(entry))
      || (typeof entry === "string" && entry.length <= MAX_REQUEST_STRING);
    if (!PARAM_NAME.test(name) || !valid) { return undefined; }
    params[name] = entry as CellParamValue;
  }
  return params;
}

/** The values a raw `params` attribute lists, or undefined when it is not a params list. */
export function readOutputParams(attr: string): Record<string, CellParamValue> | undefined {
  const values: Record<string, CellParamValue> = {};
  if (attr === "") { return values; }
  const pair = /([A-Za-z][A-Za-z0-9_]*)=("(?:[^"\\]|\\.)*"|[^;"]*)(;|$)/y;
  let at = 0;
  while (at < attr.length) {
    pair.lastIndex = at;
    const match = pair.exec(attr);
    if (!match || Object.hasOwn(values, match[1]!)) { return undefined; }
    const value = readScalar(match[2]!);
    if (value === undefined) { return undefined; }
    values[match[1]!] = value;
    at = pair.lastIndex;
    if (match[3] === "" && at < attr.length) { return undefined; }
  }
  return attr.endsWith(";") ? undefined : values;
}

/** True when an output's `params` attribute differs from the values of its cell's param lines. */
export function isOutputParamsStale(outputParams: string | undefined, options: string): boolean {
  const current = formatOutputParams(paramValues(parseCellParams(options)));
  if (outputParams === undefined) { return current !== ""; }
  const written = readOutputParams(outputParams);
  return written === undefined || formatOutputParams(written) !== current;
}

function formatScalar(value: CellParamValue): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function formatValueToken(param: CellParam, value: CellParamValue): string | undefined {
  if (param.kind === "checkbox") { return typeof value === "boolean" ? String(value) : undefined; }
  if (param.kind === "slider") { return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined; }
  if (typeof value === "boolean" || (typeof value === "number" && !Number.isFinite(value))) { return undefined; }
  return formatScalar(value);
}

function readScalar(text: string): CellParamValue | undefined {
  if (text === "true") { return true; }
  if (text === "false") { return false; }
  if (NUMBER.test(text)) { return Number(text); }
  const quoted = STRING.exec(text);
  if (!quoted) { return undefined; }
  try { return JSON.parse(text) as string; } catch { return undefined; }
}

/** A double-quoted string with `\"` and `\\` escapes, or a number; undefined for anything else. */
function readChoice(text: string): number | string | undefined {
  const quoted = STRING.exec(text);
  if (quoted) { return quoted[1]!.replace(/\\(["\\])/g, "$1"); }
  return NUMBER.test(text) ? Number(text) : undefined;
}

function locate(options: string): Located[] {
  const found: Located[] = [];
  let offset = 0;
  for (const raw of options.split(/(?<=\n)/)) {
    const lineStart = offset;
    offset += raw.length;
    if (!raw.startsWith("#|")) { continue; }
    const line = raw.replace(/\r?\n$/, "");
    const match = LINE.exec(line);
    if (!match) { continue; }
    const name = match[1]!;
    if (found.some((located) => located.param.name === name)) { continue; }
    const located = parseArgs(name, match[2] as CellParam["kind"], match[3]!, line.indexOf("(") + 1);
    if (!located) { continue; }
    found.push({ param: located.param, valueStart: lineStart + located.valueStart, valueEnd: lineStart + located.valueEnd });
    if (found.length === MAX_PARAMS) { break; }
  }
  return found;
}

function parseArgs(name: string, kind: CellParam["kind"], args: string, base: number): Located | undefined {
  const done = (param: CellParam, value: Piece): Located => ({ param, valueStart: base + value.start, valueEnd: base + value.end });
  if (kind === "checkbox") {
    const [value, ...rest] = split(args, ",");
    if (!value || rest.length > 0 || (value.text !== "true" && value.text !== "false")) { return undefined; }
    return done({ name, kind, value: value.text === "true" }, value);
  }
  if (kind === "select") {
    const halves = split(args, ";");
    if (halves.length !== 2) { return undefined; }
    const listed = split(halves[0]!.text, ",", halves[0]!.start);
    const values = listed.map((piece) => readChoice(piece.text));
    const value = readChoice(halves[1]!.text);
    if (value === undefined || values.some((choice) => choice === undefined)) { return undefined; }
    return done({ name, kind, choices: values as (number | string)[], value }, halves[1]!);
  }
  const pieces = split(args, ",");
  if (pieces.length < 3 || pieces.length > 5) { return undefined; }
  const numbers = pieces.slice(0, 3).map((piece) => (NUMBER.test(piece.text) ? Number(piece.text) : undefined));
  if (numbers.some((number) => number === undefined)) { return undefined; }
  const [min, max, raw] = numbers as [number, number, number];
  let step: number | undefined;
  let log = false;
  for (const piece of pieces.slice(3)) {
    const stepped = /^step[ \t]*=[ \t]*(.+)$/.exec(piece.text);
    if (stepped && step === undefined && NUMBER.test(stepped[1]!)) { step = Number(stepped[1]); }
    else if (piece.text === "log" && !log) { log = true; }
    else { return undefined; }
  }
  const value = Math.min(Math.max(raw, min), max);
  return done({ name, kind, min, max, ...(step === undefined ? {} : { step }), ...(log ? { log } : {}), value }, pieces[2]!);
}

/** Splits `text` at `separator` outside double-quoted strings; pieces are trimmed and carry their offsets (plus `base`). */
function split(text: string, separator: string, base = 0): Piece[] {
  const pieces: Piece[] = [];
  let quoted = false;
  let from = 0;
  const push = (to: number): void => {
    const raw = text.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    pieces.push({ text: trimmed, start: base + from + lead, end: base + from + lead + trimmed.length });
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted && char === "\\") { i++; }
    else if (char === '"') { quoted = !quoted; }
    else if (!quoted && char === separator) { push(i); from = i + 1; }
  }
  push(text.length);
  return pieces;
}
