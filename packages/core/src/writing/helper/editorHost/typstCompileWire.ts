/** Converts Typst compiles to and from the JSON form they take between the web build and the editor page's host command. */
// CONTRACT: documents/contracts/editor-host.md#typst-compiler

import { base64ToBytes, bytesToBase64 } from "../../../encoding/index.js";
import type { LocatedProblem } from "../../latex/index.js";
import type { TypstCite } from "../../review/index.js";

/** Paths are relative to the project folder; `sources` is the editor text that shadows the files on disk. */
export interface TypstHostRequest {
  projectId: string;
  main: string;
  sources: Array<{ path: string; text: string }>;
}

/** Problem files are relative to the project folder. */
export type TypstHostOutcome =
  | { status: "succeeded"; pdf: Uint8Array; problems: LocatedProblem[]; cites: TypstCite[] }
  | { status: "failed"; problems: LocatedProblem[] };

type WireOutcome =
  | { status: "succeeded"; pdfBase64: string; problems: LocatedProblem[]; cites: TypstCite[] }
  | { status: "failed"; problems: LocatedProblem[] };

type Fields = Record<string, unknown>;
const isObject = (value: unknown): value is Fields => typeof value === "object" && value !== null;
const isString = (value: unknown): value is string => typeof value === "string";

/** Throws on anything that is not a compile request. */
export function typstRequestFromWire(wire: unknown): TypstHostRequest {
  const fail = (why: string): never => { throw new Error(`Malformed Typst compile request from LabShelf: ${why}`); };
  if (!isObject(wire) || !isString(wire.projectId) || !isString(wire.main)) { return fail("missing projectId or main"); }
  if (!Array.isArray(wire.sources)) { return fail("sources is not a list"); }
  const sources = wire.sources.map((source: unknown) => {
    if (!isObject(source) || !isString(source.path) || !isString(source.text)) { return fail("a source lacks its path or text"); }
    return { path: source.path, text: source.text };
  });
  return { projectId: wire.projectId, main: wire.main, sources };
}

export function typstOutcomeToWire(outcome: TypstHostOutcome): WireOutcome {
  return outcome.status === "succeeded"
    ? { status: "succeeded", pdfBase64: bytesToBase64(outcome.pdf), problems: outcome.problems, cites: outcome.cites }
    : { status: "failed", problems: outcome.problems };
}

/** Throws on anything that is not a compile outcome in wire form. */
export function typstOutcomeFromWire(wire: unknown): TypstHostOutcome {
  const fail = (why: string): never => { throw new Error(`Malformed Typst compile outcome from the editor host: ${why}`); };
  if (!isObject(wire) || !Array.isArray(wire.problems)) { return fail("missing problems"); }
  const problems = wire.problems as LocatedProblem[];
  if (wire.status === "failed") { return { status: "failed", problems }; }
  if (wire.status !== "succeeded") { return fail(`unknown status ${JSON.stringify(wire.status)}`); }
  if (!isString(wire.pdfBase64)) { return fail("a succeeded outcome lacks its PDF"); }
  if (!Array.isArray(wire.cites)) { return fail("a succeeded outcome lacks its cites"); }
  return { status: "succeeded", pdf: base64ToBytes(wire.pdfBase64), problems, cites: wire.cites as TypstCite[] };
}
