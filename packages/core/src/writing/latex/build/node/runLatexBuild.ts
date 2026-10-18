/** Compiles a LaTeX project into its build folder and puts the PDF next to the main file only when the build succeeds. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { writeFileAtomic } from "../../../../library/node/index.js";
import type { ILogger } from "../../../../ports/index.js";
import type { LatexToolchain } from "../../toolchain/index.js";
import type { LatexBuildResult } from "../buildResult.js";
import { latexBuildCommand, type PartialBuild } from "../latexBuildCommand.js";
import { writeSectionStatePackage } from "../section/node/index.js";
import { compileLatex } from "./compileLatex.js";
import type { ProblemPlaces } from "./locateProblems.js";
import { planLatexPreview } from "./planLatexPreview.js";
import { withIncludeOnlyFile } from "./preambleFormat/index.js";
import { runSectionPreview, shownPdfName } from "./runSectionPreview.js";

export interface LatexBuildRequest extends PartialBuild {
  toolchain: LatexToolchain;
  projectFolder: string;
  /** The main file, relative to the project folder. */
  main: string;
  /** A preview runs the engine once, without bibliography or reruns; a full build runs latexmk. Full when absent. */
  mode?: "preview" | "full";
  /** The file being edited, relative to the project folder; a preview typesets only it when main `\include`s it. */
  editedFile?: string;
  /** 1-based line of the edit in `editedFile`. */
  editedLine?: number;
  /** Receives every file the build writes except the final PDF. */
  outDir: string;
  signal: AbortSignal;
  logger: ILogger;
}

const MODULE = "writing/build";

/** Puts a built PDF next to main; a full build's also becomes the base later section previews swap into. */
async function publishPdf(request: LatexBuildRequest, places: ProblemPlaces, base: string, result: LatexBuildResult, full: boolean): Promise<LatexBuildResult> {
  if (result.status !== "succeeded") { return result; }
  const bytes = await fs.readFile(result.pdf);
  const pdf = path.join(places.workDir, `${base}.pdf`);
  await writeFileAtomic(pdf, bytes);
  if (full) { await writeFileAtomic(path.join(request.outDir, shownPdfName(base)), bytes); }
  return { ...result, pdf };
}

/** A preview tries the edited section alone, then the chapter preview; without a full build's aux it runs the full build. */
async function build(request: LatexBuildRequest, places: ProblemPlaces, base: string): Promise<{ result: LatexBuildResult; mode: string }> {
  if (request.mode === "preview") {
    const section = await runSectionPreview(request, places, base);
    if (section) { return { result: section, mode: "section" }; }
  }
  const preview = request.mode === "preview" ? await planLatexPreview(request) : undefined;
  if (!preview) { await writeSectionStatePackage(request.outDir); }
  const command = preview?.command ?? latexBuildCommand(request.toolchain, path.basename(request.main), request.outDir, { ...request, capturesSectionState: true });
  const run = (): Promise<LatexBuildResult> => compileLatex(request, places, { job: base, command });
  const result = await (preview ? withIncludeOnlyFile(request.outDir, preview.includeOnlyFile, run) : run());
  return { result: await publishPdf(request, places, base, result, !preview), mode: preview ? "preview" : "full" };
}

export async function runLatexBuild(request: LatexBuildRequest): Promise<LatexBuildResult> {
  const mainFile = path.join(request.projectFolder, request.main);
  const places: ProblemPlaces = { projectFolder: request.projectFolder, workDir: path.dirname(mainFile), mainFile };
  const base = path.basename(request.main, path.extname(request.main));
  const started = Date.now();
  await fs.mkdir(request.outDir, { recursive: true });
  // INVARIANT: a preview changes the build files behind latexmk's back, so its database goes and the next full build reruns.
  const dropDatabase = (): Promise<void> => fs.rm(path.join(request.outDir, `${base}.fdb_latexmk`), { force: true });
  const { result, mode } = await build(request, places, base).catch(async (error: unknown) => {
    if (request.mode === "preview") { await dropDatabase(); }
    throw error;
  });
  if (mode !== "full") { await dropDatabase(); }
  const errors = result.status === "cancelled" ? 0 : result.problems.filter((problem) => problem.severity === "error").length;
  await request.logger.log(result.status === "failed" ? "WARN" : "INFO", MODULE, `LaTeX build ${result.status}`, {
    main: mainFile, engine: request.toolchain.engine, mode, outDir: request.outDir, errors, ms: Date.now() - started,
  });
  return result;
}
