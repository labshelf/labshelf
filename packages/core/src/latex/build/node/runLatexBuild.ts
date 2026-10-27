/** Compiles a LaTeX project into its build folder and puts the PDF next to the main file only when the build succeeds. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { writeFileAtomic } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import type { LatexToolchain } from "../../toolchain.js";
import {
  type LatexBuildResult,
  createLatexBuildCommand,
  type PartialBuild,
  type BuildCommand,
  createLatexPreviewCommand,
} from "../index.js";
import { writeSectionBuildStatePackage } from "../section/node/index.js";
import { deriveSectionBuildStateFileName } from "../section/index.js";
import { buildLatexProject } from "./buildLatexProject.js";
import type { ProblemPlaces } from "./findProblems.js";
import { withIncludeOnlyFile } from "./includeOnlyFile.js";
import { runSectionPreview, deriveShownPdfName } from "./runSectionPreview.js";
import { buildPreambleFormat } from "./buildPreambleFormat.js";

interface PreviewPlanInput {
  toolchain: LatexToolchain;
  projectFolder: string;
  main: string;
  /** The user's explicit include-only selection. */
  includeOnly?: string;
  outDir: string;
  haltOnError?: boolean;
  signal: AbortSignal;
  logger: ILogger;
}

interface PreviewPlan {
  command: BuildCommand;
  /** The chapter to hand the format through the include-only file; the command carries it when no format is used. */
  includeOnlyFile: string | undefined;
}



async function planLatexPreview(input: PreviewPlanInput): Promise<PreviewPlan | undefined> {
  const base = path.basename(input.main, path.extname(input.main));
  const aux = path.join(input.outDir, `${base}.aux`);
  if (!await fs.stat(aux).then(() => true, () => false)) {
    await input.logger.log("INFO", MODULE, "LaTeX preview falls back to a full build: no .aux yet", { main: input.main, aux });
    return undefined;
  }
  const includeOnly = input.includeOnly;
  const mainPath = path.join(input.projectFolder, input.main);
  const found = await buildPreambleFormat({ ...input, mainPath });
  const format = found && { name: found.name, searchPath: `${found.dir}${path.delimiter}` };
  const command = createLatexPreviewCommand(input.toolchain.engine, path.basename(input.main), input.outDir, { includeOnly, format, haltOnError: input.haltOnError });
  return { command, includeOnlyFile: format ? includeOnly : undefined };
}

export interface LatexBuildRequest extends PartialBuild {
  toolchain: LatexToolchain;
  projectFolder: string;
  /** The main file, relative to the project folder. */
  main: string;
  /** A preview runs the engine once, without bibliography or reruns; a full build runs latexmk. Full when absent. */
  mode?: "preview" | "full";
  /** The file being edited, relative to the project folder. */
  editedFile?: string;
  /** 1-based line of the edit in `editedFile`. */
  editedLine?: number;
  /** Receives every file the build writes except the final PDF. */
  outDir: string;
  signal: AbortSignal;
  logger: ILogger;
  /** The command latexmk runs biber's WASM build through; the TeX's own biber when absent. */
  biber?: readonly string[];
  /** Stops the LaTeX engine at the first error. */
  haltOnError?: boolean;
}

const MODULE = "writing/build";

/** Puts a built PDF next to main; a full build's also becomes the base later section previews swap into. */
async function publishPdf(request: LatexBuildRequest, places: ProblemPlaces, base: string, result: LatexBuildResult, full: boolean): Promise<LatexBuildResult> {
  if (result.status !== "succeeded") { return result; }
  const bytes = await fs.readFile(result.pdf);
  const pdf = path.join(places.workDir, `${base}.pdf`);
  await writeFileAtomic(pdf, bytes);
  if (full) { await writeFileAtomic(path.join(request.outDir, deriveShownPdfName(base)), bytes); }
  return { ...result, pdf };
}

/** Why a preview must build the whole document: it has no edit to scope to, or no full PDF exists to swap pages into. */
async function wholeDocumentReason(request: LatexBuildRequest, base: string): Promise<string | undefined> {
  if (request.editedFile === undefined || request.editedLine === undefined) { return "no-edit"; }
  const hasFullPdf = await fs.stat(path.join(request.outDir, deriveShownPdfName(base))).then(() => true, () => false);
  return hasFullPdf ? undefined : "no full PDF yet";
}

// A section that shares page layout needs a document preview to preserve its surroundings.
async function build(request: LatexBuildRequest, places: ProblemPlaces, base: string): Promise<{ result: LatexBuildResult; mode: string }> {
  const reason = request.mode === "preview" ? await wholeDocumentReason(request, base) : undefined;
  if (reason) { await request.logger.log("INFO", MODULE, `LaTeX preview builds the whole document: ${reason}`, { main: request.main, reason }); }
  const isPreview = request.mode === "preview" && !reason;
  if (isPreview) {
    const section = await runSectionPreview(request, places, base);
    if (section) { return { result: section, mode: "section" }; }
  }
  const preview = isPreview ? await planLatexPreview(request) : undefined;
  // INVARIANT: a document preview can change pagination without refreshing the full build's section state.
  if (preview) { await fs.rm(path.join(request.outDir, deriveSectionBuildStateFileName(base)), { force: true }); }
  if (!preview) { await writeSectionBuildStatePackage(request.outDir); }
  const { biber, ...partial } = request;
  const command = preview?.command ?? createLatexBuildCommand(request.toolchain, path.basename(request.main), request.outDir, {
    ...partial, capturesSectionState: true, ...(biber && { biber: { command: biber, root: request.projectFolder } }),
  });
  const run = (): Promise<LatexBuildResult> => buildLatexProject(request, places, { job: base, command });
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
  // TRAP: latexmk records a failed step (e.g. biber blocked by macOS) and refuses every later run until a source changes.
  if (mode !== "full" || result.status === "failed") { await dropDatabase(); }
  const errors = result.status === "cancelled" ? 0 : result.problems.filter((problem) => problem.severity === "error").length;
  await request.logger.log(result.status === "failed" ? "WARN" : "INFO", MODULE, `LaTeX build ${result.status}`, {
    main: mainFile, engine: request.toolchain.engine, mode, outDir: request.outDir, errors, ms: Date.now() - started,
  });
  return result;
}
