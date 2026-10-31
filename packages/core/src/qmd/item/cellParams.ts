// Reads and rewrites the `#| param:` lines of a code cell's options, and gives the `params` attribute of its output block.
// CONTRACT: documents/contracts/qmd-items.md#cell-parameters
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
