// Builds one root of a writing project with its format's compiler, preparing TeX first and installing the LaTeX packages it misses.
import * as path from "node:path";

import type { ILogger, LibraryFileSystem } from "../../../ports/index.js";
import { deriveTexProblemClass, type LatexBuildResult, type LatexToolchain, type TexInstallKind, type TexProvider } from "../../../latex/index.js";
import { runLatexBuild, type ManagedTexProvider } from "../../../latex/node/index.js";
import type { ProjectEntry } from "../../project/index.js";
import { deriveBuildRootFolder } from "../../project/buildRoot.js";
import { removeFlatBuildFiles } from "../../project/node/exportProject.js";
import type { ProjectContentPort } from "../../project/index.js";
import type { TypstBuildResult, TypstSession } from "../../../typst/index.js";
import { runTypstBuild, type TypstPackageStore } from "../../../typst/node/index.js";
import { updateProjectValues } from "../../project/node/index.js";
import { formatError } from "../../../errors/index.js";
import { buildTypstPreviewPdf, type ProjectBuildResult, type TexSetupAsk, type ToolchainMissing } from "../projectBuild.js";

const MODULE = "writing/build";
const MAX_INSTALL_ROUNDS = 10;

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

// --- Preparing TeX ---

export interface ToolchainDeps {
  logger: ILogger;
  prompt: TexSetupAsk;
  tex: ManagedTexProvider;
}

const INSTALL_TITLES: Readonly<Record<TexInstallKind, string>> = {
  tinytex: "Installing TinyTeX",
  texlive: "Installing TeX Live",
};

async function install(deps: ToolchainDeps, kind: TexInstallKind, context: Record<string, unknown>): Promise<ToolchainMissing | undefined> {
  await deps.logger.log("INFO", MODULE, "Installing TeX", { ...context, kind });
  try {
    await deps.prompt.progress(INSTALL_TITLES[kind], (report) =>
      deps.tex.install(kind, (fraction) => report(fraction === null ? "" : `${Math.round(fraction * 100)}%`)));
  } catch (error) {
    await deps.logger.error(MODULE, error, { ...context, kind, action: "install-tex" });
    return { status: "toolchain-missing", reason: "install-failed", message: formatError(error) };
  }
  await deps.logger.log("INFO", MODULE, "Installed TeX", { ...context, kind });
  return undefined;
}

/** The program that builds the project; when no TeX is found, asks which one to install and installs it. */
export async function ensureToolchain(
  project: Extract<ProjectEntry, { kind: "ready" }>,
  deps: ToolchainDeps,
): Promise<LatexToolchain | ToolchainMissing> {
  const engine = project.settings.engine ?? "pdflatex";
  const context = { folder: project.folder, engine };
  const found = await deps.tex.resolve(engine);
  if (found !== "missing") { return found; }
  await deps.logger.log("WARN", MODULE, "No TeX installation found; asking which to install", context);
  const kind = await deps.prompt.chooseInstall();
  if (!kind) {
    await deps.logger.log("INFO", MODULE, "The user declined the TeX install", context);
    return { status: "toolchain-missing", reason: "declined" };
  }
  const failed = await install(deps, kind, context);
  if (failed) { return failed; }
  const installed = await deps.tex.resolve(engine);
  if (installed !== "missing") { return installed; }
  await deps.logger.log("WARN", MODULE, "TeX is still missing after the install", { ...context, kind });
  return { status: "toolchain-missing", reason: "install-failed", message: `The ${kind} install finished but no TeX was found` };
}

// --- Installing missing TeX files ---

export interface InstallingBuild<R> {
  compile(round: { force: boolean }): Promise<R>;
  /** The TeX file the build missed, if any. */
  missingFile(result: R): string | undefined;
  tex: Pick<TexProvider, "installMissing">;
  logger: ILogger;
}

/** The last build's result: one without a missing file, one whose file could not be installed, or the one after the last allowed round. */
export async function buildInstallingPackages<R>(run: InstallingBuild<R>): Promise<R> {
  // TRAP: latexmk does not rerun a failed build whose sources are unchanged, so a rebuild after an install is forced.
  let result = await run.compile({ force: false });
  for (let round = 1; ; round++) {
    const fileName = run.missingFile(result);
    if (!fileName) { return result; }
    if (round > MAX_INSTALL_ROUNDS) {
      await run.logger.log("WARN", MODULE, "Stopped installing missing TeX files", { fileName, rounds: MAX_INSTALL_ROUNDS });
      return result;
    }
    const installed = await run.tex.installMissing(fileName);
    await run.logger.log(installed ? "INFO" : "WARN", MODULE, installed ? "Installed a missing TeX file" : "Could not install a missing TeX file", { fileName, round });
    if (!installed) { return result; }
    result = await run.compile({ force: true });
  }
}

// --- Building ---

export interface ProjectBuildDeps extends ToolchainDeps {
  projectWriter?: Pick<LibraryFileSystem, "writeText">;
  projects: Pick<ProjectContentPort, "projectBuildDir">;
  typst: { get(logger: ILogger): Promise<{ session: TypstSession; packages: TypstPackageStore }> };
  /** The command latexmk runs biber's WASM build through; the TeX's own biber when absent. */
  biber?: readonly string[];
}

export interface ProjectBuildOptions {
  /** Stops the LaTeX engine at the first error. */
  haltOnError?: boolean;
  /** The root to compile, relative to the project folder; the main file when absent. */
  root?: string;
  /** An `\include` path to typeset alone (LaTeX). */
  includeOnly?: string;
  /** Rebuilds even when no source changed (LaTeX). */
  force?: boolean;
  /** One engine pass for a quick look, or a complete latexmk build (LaTeX); full when absent. */
  mode?: "preview" | "full";
  /** The file being edited, relative to the project folder; a LaTeX preview typesets only it when it is an `\include`d chapter. */
  editedFile?: string;
  /** 1-based line of the edit in `editedFile`. */
  editedLine?: number;
  /** Unsaved text by absolute path; a Typst compile with it writes only the preview PDF. */
  unsaved?: ReadonlyMap<string, string>;
  signal?: AbortSignal;
  /** Called once the toolchain is ready and the compile starts. */
  onCompile?(root: string): void;
}

// A failure leaves the macro undefined, which LaTeX reports itself, so the build still runs.
async function generateValues(project: ReadyProject, logger: ILogger, writer: ProjectBuildDeps["projectWriter"]): Promise<void> {
  if (!project.settings.values?.length) { return; }
  try {
    await updateProjectValues(project, logger, undefined, writer);
  } catch (error) {
    await logger.error(MODULE, error, { projectFolder: project.folder, action: "generate-values" });
  }
}

async function buildLatex(project: ReadyProject, root: string, deps: ProjectBuildDeps, options: ProjectBuildOptions): Promise<ProjectBuildResult> {
  const toolchain = await ensureToolchain(project, deps);
  if ("status" in toolchain) { return toolchain; }
  options.onCompile?.(root);
  await generateValues(project, deps.logger, deps.projectWriter);
  const buildDir = deps.projects.projectBuildDir(project.settings.id);
  await removeFlatBuildFiles(buildDir, root, deps.logger);
  const outDir = path.join(buildDir, deriveBuildRootFolder(root));
  return buildInstallingPackages<LatexBuildResult>({
    compile: ({ force }) => runLatexBuild({
      toolchain, projectFolder: project.folder, main: root, outDir,
      signal: options.signal ?? new AbortController().signal, logger: deps.logger, ...(deps.biber && { biber: deps.biber }),
      ...(options.includeOnly !== undefined && { includeOnly: options.includeOnly }), ...((force || options.force) && { force: true }),
      ...(options.mode !== undefined && { mode: options.mode }), ...(options.editedFile !== undefined && { editedFile: options.editedFile }),
      ...(options.editedLine !== undefined && { editedLine: options.editedLine }),
      ...(options.haltOnError !== undefined && { haltOnError: options.haltOnError }),
    }),
    missingFile: (result) => ("problems" in result ? deriveTexProblemClass(result.problems).missingFile : undefined),
    tex: { installMissing: (fileName) => deps.prompt.progress(`Installing the LaTeX package for ${fileName}`, () => deps.tex.installMissing(fileName)) },
    logger: deps.logger,
  });
}

async function buildTypst(project: ReadyProject, root: string, deps: ProjectBuildDeps, options: ProjectBuildOptions): Promise<TypstBuildResult> {
  const { session, packages } = await deps.typst.get(deps.logger);
  options.onCompile?.(root);
  const previewPdf = buildTypstPreviewPdf(project, root, deps.projects, path);
  const { dir, name } = path.parse(root);
  return runTypstBuild({
    session, packages, projectFolder: project.folder, main: root, logger: deps.logger,
    sources: options.unsaved ?? new Map(),
    outputs: options.unsaved ? [previewPdf] : [previewPdf, path.join(project.folder, dir, `${name}.pdf`)],
    ...(options.signal && { signal: options.signal }),
  });
}

/** Throws only when the host's ports throw; every expected outcome is a result. */
export async function buildProject(project: ReadyProject, deps: ProjectBuildDeps, options: ProjectBuildOptions = {}): Promise<ProjectBuildResult> {
  const root = options.root ?? project.main;
  if (!root) { return { status: "no-main" }; }
  const started = Date.now();
  const result = project.settings.format === "typst"
    ? await buildTypst(project, root, deps, options)
    : await buildLatex(project, root, deps, options);
  const level = result.status === "failed" || result.status === "toolchain-missing" ? "WARN" : "INFO";
  await deps.logger.log(level, MODULE, `Project build ${result.status}`, {
    projectFolder: project.folder, root, live: options.unsaved !== undefined, ms: Date.now() - started,
    ...("reason" in result && { reason: result.reason }),
  });
  return result;
}
