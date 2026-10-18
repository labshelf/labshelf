/** Converts LaTeX helper calls to and from the JSON form they take between the web build and the editor page's host command. */
// CONTRACT: documents/contracts/editor-host.md#latex-helper

import { base64ToBytes, bytesToBase64 } from "../../../encoding/index.js";
import type { LocatedProblem } from "../../latex/index.js";
import { LATEX_ENGINES } from "../../project/index.js";
import { HELPER_BUILD_STATUSES } from "../helperMessages.js";
import type { HelperCompileResult, HelperProject } from "../latexHelper.js";

export interface WireProject {
  projectId: string;
  main: string;
  engine: HelperProject["engine"];
  files: Array<{ path: string; base64: string }>;
}

export type WireCompileResult =
  | { status: "succeeded"; problems: LocatedProblem[]; pdfBase64: string }
  | { status: Exclude<HelperCompileResult["status"], "succeeded">; problems: LocatedProblem[] };

type Fields = Record<string, unknown>;
const isObject = (value: unknown): value is Fields => typeof value === "object" && value !== null;
const isString = (value: unknown): value is string => typeof value === "string";

export function projectToWire(project: HelperProject): WireProject {
  const { projectId, main, engine, files } = project;
  return { projectId, main, engine, files: files.map(({ path, bytes }) => ({ path, base64: bytesToBase64(bytes) })) };
}

/** Throws on anything that is not a project in wire form. */
export function projectFromWire(wire: unknown): HelperProject {
  const fail = (why: string): never => { throw new Error(`Malformed helper project from the editor host: ${why}`); };
  if (!isObject(wire) || !isString(wire.projectId) || !isString(wire.main)) { return fail("missing projectId or main"); }
  const engine = LATEX_ENGINES.find((known) => known === wire.engine) ?? fail(`unknown engine ${JSON.stringify(wire.engine)}`);
  if (!Array.isArray(wire.files)) { return fail("files is not a list"); }
  const files = wire.files.map((file: unknown) => {
    if (!isObject(file) || !isString(file.path) || !isString(file.base64)) { return fail("a file lacks its path or base64"); }
    return { path: file.path, bytes: base64ToBytes(file.base64) };
  });
  return { projectId: wire.projectId, main: wire.main, engine, files };
}

export function compileResultToWire(result: HelperCompileResult): WireCompileResult {
  return result.status === "succeeded"
    ? { status: "succeeded", problems: result.problems, pdfBase64: bytesToBase64(result.pdf) }
    : { status: result.status, problems: result.problems };
}

/** Throws on anything that is not a compile result in wire form. */
export function compileResultFromWire(wire: unknown): HelperCompileResult {
  const fail = (why: string): never => { throw new Error(`Malformed helper compile result from the editor host: ${why}`); };
  if (!isObject(wire) || !Array.isArray(wire.problems)) { return fail("missing problems"); }
  const status = HELPER_BUILD_STATUSES.find((known) => known === wire.status) ?? fail(`unknown status ${JSON.stringify(wire.status)}`);
  const problems = wire.problems as LocatedProblem[];
  if (status !== "succeeded") { return { status, problems }; }
  if (!isString(wire.pdfBase64)) { return fail("a succeeded result lacks its PDF"); }
  return { status, problems, pdf: base64ToBytes(wire.pdfBase64) };
}
