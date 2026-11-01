/** Reads the fields of the helper's math messages: the evalMath request's op and tex (capped at 8 KiB) and the mathResult a page receives. */
// CONTRACT: documents/contracts/helper.md#messages

import { isRecord } from "../guards/index.js";
import { isMathOp, type MathOp, type MathResult, type MathState } from "../qmd/compute/cellRunner.js";
import { FieldError } from "./fieldError.js";

const MAX_MATH_TEX_BYTES = 8 * 1024;
const MAX_MATH_ENTRIES = 200;

const MATH_STATES: readonly MathState[] = ["value", "proved", "sampled", "differs", "conditional", "unread", "failed"];

type Body = Record<string, unknown>;

const invalid = (message: string): FieldError => new FieldError("invalid-field", message);

function text(body: Body, key: string): string {
  const value = body[key];
  if (typeof value !== "string") { throw invalid(`${key} is not a string`); }
  return value;
}

function choice<T extends string>(body: Body, key: string, choices: readonly T[]): T {
  const value = body[key];
  if (!choices.includes(value as T)) { throw invalid(`${key} is not one of ${choices.join(", ")}`); }
  return value as T;
}

function strings(body: Body, key: string): string[] {
  const value = body[key];
  if (!Array.isArray(value)) { throw invalid(`${key} is not an array`); }
  if (value.length > MAX_MATH_ENTRIES) { throw new FieldError("limit", `${key} has more than ${MAX_MATH_ENTRIES} entries`); }
  return value.map((entry, index) => {
    if (typeof entry !== "string") { throw invalid(`${key}[${index}] is not a string`); }
    return entry;
  });
}

function counterexample(body: Body, key: string): NonNullable<MathResult["counterexample"]> {
  const value = body[key];
  if (!isRecord(value)) { throw invalid(`${key} is not an object`); }
  const rawPoint = value.point;
  if (!isRecord(rawPoint)) { throw invalid(`${key}.point is not an object`); }
  const point: Record<string, number> = {};
  for (const [name, coordinate] of Object.entries(rawPoint)) {
    if (typeof coordinate !== "number" || !Number.isFinite(coordinate)) { throw invalid(`${key}.point.${name} is not a finite number`); }
    point[name] = coordinate;
  }
  return { point, lhs: text(value, "lhs"), rhs: text(value, "rhs") };
}

/** The `op` and `tex` of an evalMath request; the tex counts UTF-8 bytes against the 8 KiB cap. */
export function readEvalMath(body: Body): { op: MathOp; tex: string } {
  const op = body["op"];
  if (!isMathOp(op)) { throw invalid("op is not a math operation"); }
  const tex = text(body, "tex");
  // The UTF-8 size is at least the length and at most three times it, so only the middle band needs the encoder.
  const tooLarge = tex.length > MAX_MATH_TEX_BYTES || (tex.length * 3 > MAX_MATH_TEX_BYTES && new TextEncoder().encode(tex).length > MAX_MATH_TEX_BYTES);
  if (tooLarge) { throw new FieldError("limit", `tex is larger than ${MAX_MATH_TEX_BYTES} bytes`); }
  return { op, tex };
}

/** The `result` of a mathResult reply: a state the page knows, with its optional fields carried as they are. */
export function readMathResult(body: Body, key = "result"): MathResult {
  const raw = body[key];
  if (!isRecord(raw)) { throw invalid(`${key} is not an object`); }
  return {
    state: choice(raw, "state", MATH_STATES),
    rewrites: strings(raw, "rewrites") as MathResult["rewrites"],
    messages: strings(raw, "messages"),
    ...(raw.latex !== undefined && { latex: text(raw, "latex") }),
    ...(raw.readAs !== undefined && { readAs: text(raw, "readAs") }),
    ...(raw.counterexample !== undefined && { counterexample: counterexample(raw, "counterexample") }),
    ...(raw.condition !== undefined && { condition: text(raw, "condition") }),
    ...(raw.restarted !== undefined && { restarted: flag(raw, "restarted") }),
  };
}

function flag(body: Body, key: string): boolean {
  const value = body[key];
  if (typeof value !== "boolean") { throw invalid(`${key} is not a boolean`); }
  return value;
}
