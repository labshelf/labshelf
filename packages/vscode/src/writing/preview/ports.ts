// Answers the reader's requests from a build preview: opens the source behind a double-click, runs its writing actions and project actions, and names the papers it cites.
import * as vscode from "vscode";

import { formatError, type ILogger, type LatexEngine, type PreviewPorts } from "@labshelf/core";
import type { IncludeOnlyState } from "../build/index.js";
import { setAutoCompile, setHaltOnError } from "../build/index.js";
import type { ReadyProject } from "../buildRootDocument.js";
import type { WritingProjects } from "../session/index.js";
import type { WritingActions } from "./buildRoots.js";
import { applyCitationFix, withCitationFixes, type CitationFixDeps } from "./citationFixes.js";
import { findCitation, openCitedPaper, type PreviewCitationDeps } from "./citations.js";
import { setCheckLimits } from "./limits.js";
import { PREVIEW_LOG_MODULE } from "./panel.js";
import { addPreviewComment, showSource } from "./synctex.js";

export type ProjectActions = Required<Pick<PreviewPorts, "runCommand" | "setAutoCompile" | "setHaltOnError" | "setEngine" | "setIncludeOnly" | "setCheckLimits" | "fixCitation">>;

export interface ProjectActionsDeps {
  logger: ILogger;
  /** Resolved on every call: the project the preview was shown for goes stale when the projects reload. */
  project(): ReadyProject | undefined;
  projects: Pick<WritingProjects, "data" | "paths" | "reload">;
  setEngine(project: ReadyProject, engine: LatexEngine): Promise<void>;
  includeOnly: Pick<IncludeOnlyState, "set">;
  fixes(): CitationFixDeps | undefined;
  recompile(): void;
  resendRoots(): void;
}

const NO_PROJECT_MESSAGE = "The preview's project is not open any more.";
const NO_LIBRARY_MESSAGE = "Open a library to fix citations.";

/** Runs an action that needs the shown project; a missing project or a failure is logged and shown, never dropped. */
async function onProject(
  deps: ProjectActionsDeps, action: string, run: (project: ReadyProject) => Promise<void> | void,
): Promise<void> {
  const project = deps.project();
  if (!project) {
    await deps.logger.log("WARN", PREVIEW_LOG_MODULE, `Preview action ${action} found no project`);
    void vscode.window.showWarningMessage(NO_PROJECT_MESSAGE);
    return;
  }
  await guarded(deps, action, () => run(project), { project: project.settings.id });
}

async function guarded(deps: ProjectActionsDeps, action: string, run: () => Promise<void> | void, context: Record<string, unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    await deps.logger.error(PREVIEW_LOG_MODULE, error, { action, ...context });
    void vscode.window.showErrorMessage(`Could not ${action}: ${formatError(error)}`);
  }
}

export function createProjectActions(deps: ProjectActionsDeps): ProjectActions {
  return {
    // The commands take the project entry as their argument, as the library's project menu passes it.
    runCommand: (id) => onProject(deps, `run ${id}`, async (project) => { await vscode.commands.executeCommand(`labshelf.writing.${id}`, project); }),
    setAutoCompile: (mode) => guarded(deps, "change auto compile", async () => { await setAutoCompile(mode); }, { mode }),
    setHaltOnError: (on) => guarded(deps, "change halt on error", async () => { await setHaltOnError(on); }, { on }),
    setEngine: (engine) => onProject(deps, "change the engine", async (project) => {
      await deps.setEngine(project, engine);
      deps.resendRoots();
    }),
    setIncludeOnly: (on) => onProject(deps, "change the include-only build", (project) => {
      deps.includeOnly.set(project.folder, on);
      deps.recompile();
    }),
    setCheckLimits: (change) => onProject(deps, "save the check limits", async (project) => {
      await setCheckLimits(deps.projects, project, change);
      deps.resendRoots();
    }),
    fixCitation: async (fix) => {
      const fixes = deps.fixes();
      if (!fixes) {
        await deps.logger.log("WARN", PREVIEW_LOG_MODULE, "Citation fix asked without a library", { kind: fix.kind, key: fix.key });
        void vscode.window.showWarningMessage(NO_LIBRARY_MESSAGE);
        return;
      }
      await applyCitationFix(fixes, fix);
    },
  };
}

/** The body pages the reader counted in a project's preview. */
export interface BodyPagesCount {
  /** The project folder of the preview panel. */
  folder: string;
  /** The root exactly as the reader reported it: relative to the project folder, `/`-separated. */
  root: string;
  contentPages: number;
}

export interface PreviewPortsDeps extends PreviewCitationDeps {
  bodyPages: (root: string, contentPages: number) => void;
  actions: WritingActions;
  /** The toolbar's project actions; the reader hides the controls whose action is absent. */
  projectActions?: ProjectActions;
  /** The citation-card fixes, when a library is open; cards carry no fix without it. */
  fixes?: () => CitationFixDeps | undefined;
}

export function createPreviewPorts(deps: PreviewPortsDeps): PreviewPorts {
  return {
    showSource: (point) => showSource(deps, point),
    addReviewComment: (point, quote, note) => addPreviewComment(deps, point, quote, note),
    lookupCitation: async (query) => {
      const entries = await findCitation(deps, query);
      const fixes = deps.fixes?.();
      return fixes ? withCitationFixes(fixes, entries) : entries;
    },
    openCitedPaper: (paperId) => openCitedPaper(deps, paperId),
    bodyPages: (root, contentPages) => deps.bodyPages(root, contentPages),
    ...deps.actions,
    ...deps.projectActions,
  };
}
