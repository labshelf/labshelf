/** Compiles a Typst project to PDF, downloading the Typst Universe packages it imports, and writes the PDF only when the compile succeeds. */
import * as path from "node:path";

import { writeFileAtomic } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import type { TypstCite } from "../../review/index.js";
import type { LocatedProblem } from "../../latex/build/node/index.js";
import type { FetchLike } from "../../latex/toolchain/node/index.js";
import { typstProblems } from "../typstProblems.js";
import type { TypstCompileResult, TypstSession } from "../typstSession.js";
import { fromCompilerPath, toCompilerPath } from "./typstFileAccess.js";
import { packageLabel, type TypstPackageStore } from "./typstPackages.js";

const MODULE = "writing/typst";

export interface TypstBuildRequest {
  session: TypstSession;
  packages: TypstPackageStore;
  projectFolder: string;
  /** The main file, relative to the project folder. */
  main: string;
  /** Unsaved editor text by absolute file path. */
  sources: ReadonlyMap<string, string>;
  /** Where the PDF goes; the result names the first. */
  outputs: readonly [string, ...string[]];
  logger: ILogger;
  /** Replaces the global fetch for package downloads. */
  fetch?: FetchLike;
  signal?: AbortSignal;
}

export type TypstBuildResult =
  /** `cites` is empty when the citation probe failed; the failure is logged. */
  | { status: "succeeded"; pdf: string; problems: LocatedProblem[]; cites: TypstCite[] }
  | { status: "failed"; problems: LocatedProblem[] };

function compileOnce(request: TypstBuildRequest, mainFile: string): Promise<TypstCompileResult> {
  const sources = new Map([...request.sources].map(([file, text]) => [toCompilerPath(file), text]));
  return request.session.compile({ root: toCompilerPath(request.projectFolder), main: toCompilerPath(mainFile), sources });
}

/** Downloads the packages the last compile missed; returns a problem per package that could not be fetched. */
async function fetchMissing(request: TypstBuildRequest, mainFile: string): Promise<LocatedProblem[] | undefined> {
  const missing = request.packages.takeMissing();
  if (missing.length === 0) { return undefined; }
  const failures: LocatedProblem[] = [];
  for (const spec of missing) {
    try {
      await request.packages.download(spec, request.fetch ?? fetch, request.signal);
      await request.logger.log("INFO", MODULE, "Downloaded Typst package", { package: packageLabel(spec) });
    } catch (error) {
      await request.logger.error(MODULE, error, { package: packageLabel(spec) });
      failures.push({ severity: "error", message: `Could not download ${packageLabel(spec)}: ${error instanceof Error ? error.message : String(error)}`, file: mainFile });
    }
  }
  return failures;
}

export async function runTypstBuild(request: TypstBuildRequest): Promise<TypstBuildResult> {
  const mainFile = path.join(request.projectFolder, request.main);
  let result = await compileOnce(request, mainFile);
  const downloadFailures = await fetchMissing(request, mainFile);
  if (downloadFailures && downloadFailures.length === 0) { result = await compileOnce(request, mainFile); }
  const problems = [...downloadFailures ?? [], ...typstProblems(result.diagnostics, mainFile, fromCompilerPath)];
  if (!result.pdf) {
    if (!problems.some((problem) => problem.severity === "error")) {
      problems.unshift({ severity: "error", message: "Typst produced no PDF and reported no error.", file: mainFile });
    }
    return { status: "failed", problems };
  }
  const pdf = result.pdf;
  await Promise.all(request.outputs.map((output) => writeFileAtomic(output, pdf)));
  const citations = result.citations ?? { failure: "The compile reported no citations." };
  if ("failure" in citations) {
    await request.logger.log("WARN", MODULE, "Citation positions unavailable; the preview shows no citation cards", { main: mainFile, reason: citations.failure });
  }
  return { status: "succeeded", pdf: request.outputs[0], problems, cites: "cites" in citations ? citations.cites : [] };
}
