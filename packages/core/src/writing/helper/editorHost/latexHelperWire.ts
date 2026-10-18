/** Converts LaTeX helper calls to and from the JSON form they take between the web build and the editor page's host command. */
// CONTRACT: documents/contracts/editor-host.md#latex-helper

import { base64ToBytes, bytesToBase64 } from "../../../encoding/index.js";
import type { LocatedProblem } from "../../latex/index.js";
import { HELPER_BUILD_STATUSES } from "../helperMessages.js";
import type { EditorHostCompileResult, EditorHostProject } from "./editorHostLatexHelper.js";

export interface WireProject {
  projectId: string;
  main: string;
  engine: EditorHostProject["engine"];
  files: Array<{ path: string; base64: string }>;
}

type Fields = Record<string, unknown>;
const isObject = (value: unknown): value is Fields => typeof value === "object" && value !== null;
const isString = (value: unknown): value is string => typeof value === "string";

export function projectToWire(project: EditorHostProject): WireProject {
  const { projectId, main, engine, files } = project;
  return { projectId, main, engine, files: files.map(({ path, bytes }) => ({ path, base64: bytesToBase64(bytes) })) };
}

/** Throws on anything that is not a compile result in wire form. */
export function compileResultFromWire(wire: unknown): EditorHostCompileResult {
  const fail = (why: string): never => { throw new Error(`Malformed helper compile result from the editor host: ${why}`); };
  if (!isObject(wire) || !Array.isArray(wire.problems)) { return fail("missing problems"); }
  const status = HELPER_BUILD_STATUSES.find((known) => known === wire.status) ?? fail(`unknown status ${JSON.stringify(wire.status)}`);
  const problems = wire.problems as LocatedProblem[];
  if (status !== "succeeded") { return { status, problems }; }
  if (!isString(wire.pdfBase64)) { return fail("a succeeded result lacks its PDF"); }
  return { status, problems, pdf: base64ToBytes(wire.pdfBase64) };
}
