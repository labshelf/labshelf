// The cell driver wire format: sentinel-framed JSON response lines, the ready line, line splitting, and the mapping of an outcome to a CellResult.
import { StringDecoder } from "node:string_decoder";

import type { CellLanguage } from "../cellLanguage.js";
import type { CellControl, CellResult, CellStatus } from "../cellRunner.js";

export const SENTINEL = "\u0001LABSHELF\u0001";

export interface DriverResponse { id: number; latex?: string; text?: string; error?: string; controls?: CellControl[] }

export type Outcome = { kind: "response"; response: DriverResponse; output: string[] } | { kind: "ended"; status: CellStatus; error?: string; output: string[] };

export function parseResponse(line: string): DriverResponse | undefined {
  try {
    const parsed: unknown = JSON.parse(line.slice(SENTINEL.length));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) { return undefined; }
    const id = (parsed as { id?: unknown }).id;
    return typeof id === "number" ? parsed as DriverResponse : undefined;
  } catch {
    return undefined;
  }
}

export function isReadyLine(line: string): boolean {
  try {
    const parsed: unknown = JSON.parse(line.slice(SENTINEL.length));
    return typeof parsed === "object" && parsed !== null && (parsed as { ready?: unknown }).ready === true;
  } catch {
    return false;
  }
}

/** Splits a stream into lines on CRLF or LF, with no cap on the line length. */
export function lineReader(onLine: (line: string) => void): { push: (chunk: Buffer) => void; flush: () => void } {
  const decoder = new StringDecoder("utf8");
  let rest = "";
  const take = (text: string): void => {
    const parts = (rest + text).split(/\r?\n/);
    rest = parts.pop() ?? "";
    for (const part of parts) { onLine(part); }
  };
  return {
    push: (chunk) => take(decoder.write(chunk)),
    flush: () => {
      take(decoder.end());
      if (rest) { const last = rest.replace(/\r$/, ""); rest = ""; onLine(last); }
    },
  };
}

export function toResult(outcome: Outcome, language: CellLanguage, durationMs: number): CellResult {
  const printed = outcome.output.join("\n");
  if (outcome.kind === "ended") {
    return { status: outcome.status, language, ...(outcome.error !== undefined ? { error: outcome.error } : {}), ...(printed ? { text: printed } : {}), durationMs };
  }
  const { response } = outcome;
  const text = [printed, response.error === undefined ? response.text : undefined].filter((part): part is string => part !== undefined && part !== "").join("\n");
  if (response.error !== undefined) {
    return { status: "error", language, error: response.error, ...(text ? { text } : {}), durationMs };
  }
  return {
    status: "ok",
    language,
    ...(response.latex !== undefined ? { latex: response.latex } : {}),
    ...(text || response.text !== undefined ? { text } : {}),
    ...(response.controls !== undefined ? { controls: response.controls } : {}),
    durationMs,
  };
}
