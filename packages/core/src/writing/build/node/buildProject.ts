// Builds one root of a writing project with its format's compiler, preparing the LaTeX toolchain first.
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import type { LatexBuildResult } from "../../latex/build/index.js";
import { runLatexBuild } from "../../latex/build/node/index.js";
import type { ProjectEntry } from "../../project/index.js";
import { rootBuildFolder } from "../../project/roots/index.js";
import { clearFlatBuildFiles } from "../../project/roots/node/index.js";
import type { ProjectDataPort } from "../../projectData/index.js";
import type { TypstBuildResult, TypstSession } from "../../typst/index.js";
import { runTypstBuild, type TypstPackageStore } from "../../typst/node/index.js";
import { updateProjectValues } from "../../values/node/index.js";
import type { ProjectBuildResult } from "../projectBuildResult.js";
import { typstPreviewPdf } from "../typstPreviewPdf.js";
import { ensureToolchain, type ToolchainDeps } from "./ensureToolchain.js";

const MODULE = "writing/build";

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

export interface ProjectBuildDeps extends ToolchainDeps {
  projects: Pick<ProjectDataPort, "updateProjectSettings" | "projectBuildDir">;
  typst: { get(logger: ILogger): Promise<{ session: TypstSession; packages: TypstPackageStore }> };
}

export interface ProjectBuildOptions {
  /** The root to compile, relative to the project folder; the main file when absent. */
  root?: string;
  /** An `\include` path to typeset alone (LaTeX). */
  includeOnly?: string;
  /** Rebuilds even when no source changed (LaTeX). */
  force?: boolean;
  /** Unsaved text by absolute path; a Typst compile with it writes only the preview PDF. */
  unsaved?: ReadonlyMap<string, string>;
  signal?: AbortSignal;
  /** Called once the toolchain is ready and the compile starts. */
  onCompile?(root: string): void;
}

// A failure leaves the macro undefined, which LaTeX reports itself, so the build still runs.
async function generateValues(project: ReadyProject, logger: ILogger): Promise<void> {
  if (!project.settings.values?.length) { return; }
  try {
    await updateProjectValues(project, logger);
  } catch (error) {
    await logger.error(MODULE, error, { projectFolder: project.folder, action: "generate-values" });
  }
}

async function buildLatex(project: ReadyProject, root: string, deps: ProjectBuildDeps, options: ProjectBuildOptions): Promise<ProjectBuildResult> {
  const toolchain = await ensureToolchain(project, deps);
  if ("status" in toolchain) { return toolchain; }
  options.onCompile?.(root);
  await generateValues(project, deps.logger);
  const buildDir = deps.projects.projectBuildDir(project.settings.id);
  await clearFlatBuildFiles(buildDir, root, deps.logger);
  const result: LatexBuildResult = await runLatexBuild({
    toolchain, projectFolder: project.folder, main: root, outDir: path.join(buildDir, rootBuildFolder(root)),
    signal: options.signal ?? new AbortController().signal, logger: deps.logger,
    ...(options.includeOnly !== undefined && { includeOnly: options.includeOnly }), ...(options.force && { force: true }),
  });
  return result;
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
