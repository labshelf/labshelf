// Builds one root of a writing project with its format's compiler, preparing TeX first and installing the LaTeX packages it misses.
import * as path from "node:path";

import type { ILogger, LibraryFileSystem } from "../../../ports/index.js";
import { classifyTexProblems, type LatexBuildResult } from "../../../latex/build/index.js";
import { runLatexBuild } from "../../../latex/build/node/index.js";
import type { ProjectEntry } from "../../project/index.js";
import { rootBuildFolder } from "../../project/roots/index.js";
import { clearFlatBuildFiles } from "../../project/roots/node/index.js";
import type { ProjectDataPort } from "../../projectData/index.js";
import type { TypstBuildResult, TypstSession } from "../../typst/index.js";
import { runTypstBuild, type TypstPackageStore } from "../../typst/node/index.js";
import { updateProjectValues } from "../../values/node/index.js";
import type { ProjectBuildResult } from "../projectBuildResult.js";
import { typstPreviewPdf } from "../typstPreviewPdf.js";
import { compileInstallingPackages } from "./compileInstallingPackages.js";
import { ensureToolchain, type ToolchainDeps } from "./ensureToolchain.js";

const MODULE = "writing/build";

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

export interface ProjectBuildDeps extends ToolchainDeps {
  projectWriter?: Pick<LibraryFileSystem, "writeText">;
  projects: Pick<ProjectDataPort, "projectBuildDir">;
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
  await clearFlatBuildFiles(buildDir, root, deps.logger);
  const outDir = path.join(buildDir, rootBuildFolder(root));
  return compileInstallingPackages<LatexBuildResult>({
    compile: ({ force }) => runLatexBuild({
      toolchain, projectFolder: project.folder, main: root, outDir,
      signal: options.signal ?? new AbortController().signal, logger: deps.logger, ...(deps.biber && { biber: deps.biber }),
      ...(options.includeOnly !== undefined && { includeOnly: options.includeOnly }), ...((force || options.force) && { force: true }),
      ...(options.mode !== undefined && { mode: options.mode }), ...(options.editedFile !== undefined && { editedFile: options.editedFile }),
      ...(options.editedLine !== undefined && { editedLine: options.editedLine }),
      ...(options.haltOnError !== undefined && { haltOnError: options.haltOnError }),
    }),
    missingFile: (result) => ("problems" in result ? classifyTexProblems(result.problems).missingFile : undefined),
    tex: { installMissing: (fileName) => deps.prompt.progress(`Installing the LaTeX package for ${fileName}`, () => deps.tex.installMissing(fileName)) },
    logger: deps.logger,
  });
}

async function buildTypst(project: ReadyProject, root: string, deps: ProjectBuildDeps, options: ProjectBuildOptions): Promise<TypstBuildResult> {
  const { session, packages } = await deps.typst.get(deps.logger);
  options.onCompile?.(root);
  const previewPdf = typstPreviewPdf(project, root, deps.projects, path);
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
