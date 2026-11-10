// Turns what a browser runtime printed and answered into a core CellResult, the way the desktop drivers' answers are read.
import { cellLanguageLabel, type CellLanguage, type CellRequest, type CellResult } from "@labshelf/core";

/** What a browser runtime answers for one cell: its value (`text` or `latex`) or its `error`, beside the text it printed. */
export interface RuntimeAnswer { printed: string; text?: string; latex?: string; error?: string; warnings?: readonly string[] }

/** @returns the result of a finished run: printed text first, then the value's text, as the desktop drivers join them. */
export function toCellResult(answer: RuntimeAnswer, language: CellLanguage, durationMs: number, restarted: boolean): CellResult {
  const text = [answer.printed, answer.error === undefined ? answer.text : undefined].filter((part): part is string => part !== undefined && part !== "").join("\n");
  const warnings = answer.warnings && answer.warnings.length > 0 ? { warnings: answer.warnings } : {};
  const again = restarted ? { restarted: true } : {};
  if (answer.error !== undefined) { return { status: "error", language, error: answer.error, ...(text ? { text } : {}), ...warnings, durationMs, ...again }; }
  return {
    status: "ok",
    language,
    ...(answer.latex !== undefined ? { latex: answer.latex } : {}),
    ...(text || answer.text !== undefined ? { text } : {}),
    ...warnings,
    durationMs,
    ...again,
  };
}

/** @returns the answer for a language the browser cannot run. */
export function unsupportedResult(language: CellLanguage): CellResult {
  return { status: "error", language, error: `${cellLanguageLabel(language)} cells run only on your computer.`, durationMs: 0 };
}

export function cancelledResult(language: CellLanguage, durationMs: number): CellResult {
  return { status: "cancelled", language, durationMs };
}

export function failedResult(language: CellLanguage, error: unknown, durationMs: number, restarted: boolean): CellResult {
  const message = error instanceof Error ? error.message : String(error);
  return { status: "error", language, error: message, durationMs, ...(restarted ? { restarted: true } : {}) };
}

// A param name must be a plain identifier, as the desktop drivers require; a dunder name could replace builtins.
const PARAM_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** @returns the first param name a driver would refuse, or undefined. */
export function findInvalidParam(params: CellRequest["params"]): string | undefined {
  return Object.keys(params ?? {}).find((name) => !PARAM_NAME.test(name));
}

const rString = (text: string): string => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;

function rValue(value: number | string | boolean): string {
  if (typeof value === "boolean") { return value ? "TRUE" : "FALSE"; }
  if (typeof value === "number") { return Number.isFinite(value) ? String(value) : Number.isNaN(value) ? "NaN" : value > 0 ? "Inf" : "-Inf"; }
  return rString(value);
}

/** @returns R assignments that set the cell's params as data before its code runs; names must have passed findInvalidParam. */
export function deriveRParamCode(params: CellRequest["params"]): string {
  return Object.entries(params ?? {}).map(([name, value]) => `${name} <- ${rValue(value)}\n`).join("");
}
