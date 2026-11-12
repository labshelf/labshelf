/** Reads the fields of the helper's math messages: the evalMath request's op and tex (capped at 8 KiB) and the mathResult a page receives; its text and boolean readers serve the source messages too. */
// CONTRACT: documents/contracts/helper.md#messages

import { isRecord } from "../guards/index.js";
import { isMathOp, type MathOp, type MathResult, type MathState } from "../qmd/compute/index.js";
import { FieldError } from "./fieldError.js";

const MAX_MATH_TEX_BYTES = 8 * 1024;
const MAX_MATH_ENTRIES = 200;

const MATH_STATES: readonly MathState[] = ["value", "proved", "sampled", "differs", "conditional", "unread", "failed"];

type Body = Record<string, unknown>;

/** A refused field of the wrong type or value; the source message readers share it. */
export const invalidField = (message: string): FieldError => new FieldError("invalid-field", message);

/** The string at `key`; anything else is refused. */
export function readTextField(body: Body, key: string): string {
  const value = body[key];
  if (typeof value !== "string") { throw invalidField(`${key} is not a string`); }
  return value;
}

/** The boolean at `key`; anything else is refused. */
export function readFlagField(body: Body, key: string): boolean {
  const value = body[key];
  if (typeof value !== "boolean") { throw invalidField(`${key} is not a boolean`); }
  return value;
}

function choice<T extends string>(body: Body, key: string, choices: readonly T[]): T {
  const value = body[key];
  if (!choices.includes(value as T)) { throw invalidField(`${key} is not one of ${choices.join(", ")}`); }
  return value as T;
}

function strings(body: Body, key: string): string[] {
  const value = body[key];
  if (!Array.isArray(value)) { throw invalidField(`${key} is not an array`); }
  if (value.length > MAX_MATH_ENTRIES) { throw new FieldError("limit", `${key} has more than ${MAX_MATH_ENTRIES} entries`); }
  return value.map((entry, index) => {
    if (typeof entry !== "string") { throw invalidField(`${key}[${index}] is not a string`); }
    return entry;
  });
}

function counterexample(body: Body, key: string): NonNullable<MathResult["counterexample"]> {
  const value = body[key];
  if (!isRecord(value)) { throw invalidField(`${key} is not an object`); }
  const rawPoint = value.point;
  if (!isRecord(rawPoint)) { throw invalidField(`${key}.point is not an object`); }
  const point: Record<string, number> = {};
  for (const [name, coordinate] of Object.entries(rawPoint)) {
    if (typeof coordinate !== "number" || !Number.isFinite(coordinate)) { throw invalidField(`${key}.point.${name} is not a finite number`); }
    point[name] = coordinate;
  }
  return { point, lhs: readTextField(value, "lhs"), rhs: readTextField(value, "rhs") };
}

/** The `op` and `tex` of an evalMath request; the tex counts UTF-8 bytes against the 8 KiB cap. */
export function readEvalMath(body: Body): { op: MathOp; tex: string } {
  const op = body["op"];
  if (!isMathOp(op)) { throw invalidField("op is not a math operation"); }
  const tex = readTextField(body, "tex");
  // The UTF-8 size is at least the length and at most three times it, so only the middle band needs the encoder.
  const tooLarge = tex.length > MAX_MATH_TEX_BYTES || (tex.length * 3 > MAX_MATH_TEX_BYTES && new TextEncoder().encode(tex).length > MAX_MATH_TEX_BYTES);
  if (tooLarge) { throw new FieldError("limit", `tex is larger than ${MAX_MATH_TEX_BYTES} bytes`); }
  return { op, tex };
}

/** The `result` of a mathResult reply: a state the page knows, with its optional fields carried as they are. */
export function readMathResult(body: Body, key = "result"): MathResult {
  const raw = body[key];
  if (!isRecord(raw)) { throw invalidField(`${key} is not an object`); }
  return {
    state: choice(raw, "state", MATH_STATES),
    rewrites: strings(raw, "rewrites") as MathResult["rewrites"],
    messages: strings(raw, "messages"),
    ...(raw.latex !== undefined && { latex: readTextField(raw, "latex") }),
    ...(raw.readAs !== undefined && { readAs: readTextField(raw, "readAs") }),
    ...(raw.counterexample !== undefined && { counterexample: counterexample(raw, "counterexample") }),
    ...(raw.condition !== undefined && { condition: readTextField(raw, "condition") }),
    ...(raw.restarted !== undefined && { restarted: readFlagField(raw, "restarted") }),
  };
}

