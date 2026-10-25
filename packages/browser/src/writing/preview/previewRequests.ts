// Answers a project preview frame's requests: recompile, open a problem, compare and mark versions, and save the check limits and build options.
import type { BuildSchedule, BuildOptions, ILogger, LatexEngine, LibraryFileSystem, PreviewRequest, ProjectContentPort } from "@labshelf/core";
import type { ExtensionSettings } from "../../platform";
import { showInOpenEditor } from "../session";
import type { FollowedBuilds, PreviewLimits } from "./previewBuilds";
import { writeProjectVersion } from "../history";
import type { Workspace } from "../../libraryUi/editorArea";

const MODULE = "writing.preview";

export interface PreviewRequestDeps {
  /** `folder` is absent while the project is not open on the page, so nothing is written for it. */
  project: { id: string; folder: string | undefined };
  fs: LibraryFileSystem;
  logger: ILogger;
  workspace: Pick<Workspace, "openTab">;
  helperProject: {
    build(projectId: string): Promise<unknown>;
    lastFullPdf(projectId: string): Uint8Array | undefined;
    setBuild(projectId: string, patch: { autoCompile?: BuildSchedule; engine?: LatexEngine; haltOnError?: boolean }): void;
  };
  data: Pick<ProjectContentPort, "updateProjectSettings">;
  builds: Pick<FollowedBuilds, "roots" | "resendRoots">;
  /** The limits the roots carry; a saved change updates them. */
  limits: PreviewLimits;
  /** The build options the roots carry; a saved change updates them. */
  options: BuildOptions;
  updateSettings(patch: Partial<Pick<ExtensionSettings, "autoCompile" | "haltOnError">>): Promise<void>;
}

async function openProblem({ project, logger, workspace, builds }: PreviewRequestDeps, root: string, index: number): Promise<void> {
  const problem = builds.roots()?.roots.find((candidate) => candidate.path === root)?.problems[index];
  if (!problem?.file) {
    await logger.log("WARN", MODULE, "No source to open for the problem", { projectId: project.id, root, index });
    return;
  }
  workspace.openTab("source", { projectId: project.id, path: problem.file }, 0);
  // Problem lines count from 1; the editor reveals zero-based lines.
  showInOpenEditor(project.id, problem.file, Math.max(0, (problem.line ?? 1) - 1));
}

async function saveLimits(deps: PreviewRequestDeps, folder: string, change: Extract<PreviewRequest, { command: "setCheckLimits" }>["limits"]): Promise<void> {
  const check: PreviewLimits = {};
  if (change.pages !== undefined) check.pages = change.pages ?? undefined;
  if (change.words !== undefined) check.words = change.words ?? undefined;
  if (change.countUpTo !== undefined) check.countUpTo = change.countUpTo;
  await deps.data.updateProjectSettings(folder, { check });
  Object.assign(deps.limits, check);
  deps.builds.resendRoots();
}

/** Saves a per-user build setting, then applies it to the open build. */
async function saveUserOption(deps: PreviewRequestDeps, patch: { autoCompile: BuildSchedule } | { haltOnError: boolean }): Promise<void> {
  await deps.updateSettings(patch);
  Object.assign(deps.options, patch);
  deps.helperProject.setBuild(deps.project.id, patch);
  deps.builds.resendRoots();
  await deps.logger.log("INFO", MODULE, "Saved a build setting", { projectId: deps.project.id, ...patch });
}

async function saveEngine(deps: PreviewRequestDeps, folder: string, engine: LatexEngine): Promise<void> {
  await deps.data.updateProjectSettings(folder, { engine });
  deps.options.engine = engine;
  deps.helperProject.setBuild(deps.project.id, { engine });
  deps.builds.resendRoots();
  await deps.logger.log("INFO", MODULE, "Saved the project's LaTeX engine", { projectId: deps.project.id, engine });
}

async function answer(deps: PreviewRequestDeps, request: PreviewRequest): Promise<void> {
  const { project, logger } = deps;
  const folder = project.folder;
  const writes = request.command === "setCheckLimits" || request.command === "setEngine" || (request.command === "runCommand" && request.id === "markVersion");
  if (writes && folder === undefined) await logger.log("WARN", MODULE, "The preview's project is not open, so nothing was written", { command: request.command, projectId: project.id });
  else if (request.command === "recompile") await deps.helperProject.build(project.id);
  else if (request.command === "openProblem") await openProblem(deps, request.root, request.index);
  else if (request.command === "setCheckLimits") await saveLimits(deps, folder as string, request.limits);
  else if (request.command === "setEngine") await saveEngine(deps, folder as string, request.engine);
  else if (request.command === "setAutoCompile") await saveUserOption(deps, { autoCompile: request.mode });
  else if (request.command === "setHaltOnError") await saveUserOption(deps, { haltOnError: request.on });
  else if (request.command === "runCommand" && request.id === "markVersion") await writeProjectVersion({ fs: deps.fs, logger, lastFullPdf: deps.helperProject.lastFullPdf }, { id: project.id, folder: folder as string });
  // The history tab lists the versions to compare.
  else if (request.command === "runCommand" && request.id === "compareVersions") deps.workspace.openTab("history", { projectId: project.id }, 1);
  else await logger.log("WARN", MODULE, "the library page does not handle this preview request", { command: request.command, projectId: project.id });
}

/** @returns the frame's request listener; a failed request is logged with its command. */
export function createPreviewRequestHandler(deps: PreviewRequestDeps): (request: PreviewRequest) => void {
  return (request) => {
    answer(deps, request).catch((error: unknown) => deps.logger.error(MODULE, error, { action: request.command, projectId: deps.project.id }));
  };
}
