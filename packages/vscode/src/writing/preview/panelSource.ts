// Builds the reader source of a build preview: the paper, the ports that answer the reader's requests and the project actions of its toolbar.
import * as vscode from "vscode";

import type { BuildRootBuilds, ILogger, PaperRecord, PathOps, ProjectSynctex } from "@labshelf/core";
import { createPreviewStore } from "@labshelf/core";
import type { ReaderPanel } from "../../reader/index.js";
import type { ReadyProject } from "../projects/index.js";
import { createWritingActions } from "./buildRoots.js";
import type { CitationFixDeps } from "./citationFixes.js";
import { type BuildPreviewsDeps, PREVIEW_LOG_MODULE } from "./panel.js";
import { createPreviewPorts, createProjectActions } from "./ports.js";

/** The paper a preview reader opens for a project's PDF. */
function createPreviewPaper(paths: PathOps, project: ReadyProject, pdf: string): PaperRecord {
  return { id: `preview:${project.settings.id}`, title: paths.basename(pdf), path: paths.dirname(pdf), citeKey: "", status: "reading" };
}

type ReaderSource = Parameters<typeof ReaderPanel.createOrShow>[1];

export interface PreviewPanelContext {
  deps: BuildPreviewsDeps;
  logger: ILogger;
  project: ReadyProject;
  pdf: string;
  builds: BuildRootBuilds;
  synctex: ProjectSynctex;
  /** The root (relative to the project folder) the preview shows, or undefined before one is shown. */
  shownRoot: () => string | undefined;
  bodyPages: (root: string, contentPages: number) => void;
  /** Sends the open preview's roots again. */
  resendRoots: () => void;
  reveal: (file: string, line: number) => Promise<void>;
  onClosed: () => void;
  beside: boolean;
}

// INVARIANT: the project is read from the open projects on every call, since a reload replaces its entry.
function currentProject(deps: BuildPreviewsDeps, folder: string): ReadyProject | undefined {
  const entry = deps.projects.list().find((candidate) => candidate.kind === "ready" && candidate.folder === folder);
  return entry?.kind === "ready" ? entry : undefined;
}

function previewProjectActions(context: PreviewPanelContext, fixes: () => CitationFixDeps | undefined) {
  const { deps, logger, project, shownRoot } = context;
  const { includeOnly } = deps;
  if (!includeOnly) { return undefined; }
  return createProjectActions({
    logger, project: () => currentProject(deps, project.folder), projects: deps.projects,
    setEngine: deps.setEngine, includeOnly, fixes, resendRoots: context.resendRoots,
    recompile: () => {
      deps.recompile(project.folder, shownRoot() ?? project.main ?? "").catch((error: unknown) => {
        void logger.error(PREVIEW_LOG_MODULE, error, { projectFolder: project.folder, action: "recompile" });
      });
    },
  });
}

export function previewPanelSource(context: PreviewPanelContext): ReaderSource {
  const { deps, logger, project, pdf, builds, synctex, shownRoot } = context;
  const fixes = (): CitationFixDeps | undefined => deps.fixes(project.folder);
  const actions = previewProjectActions(context, fixes);
  return {
    key: `preview:${project.folder}`,
    paper: createPreviewPaper(deps.paths, project, pdf),
    store: createPreviewStore(),
    pdfUri: deps.uriOf(pdf),
    rootDir: deps.uriOf(previewRootDir(deps, project)),
    preview: createPreviewPorts({
      bodyPages: context.bodyPages, fixes, ...(actions && { projectActions: actions }), ...(deps.activeSource && { activeSource: deps.activeSource }),
      logger, paths: deps.paths, projectFolder: project.folder, format: project.settings.format, listPapers: deps.listPapers,
      highlightsOf: deps.highlightsOf,
      synctex: () => synctex.load(project, shownRoot() ?? project.main),
      typstCites: () => builds.citesOf(project.folder, shownRoot() ?? project.main ?? "") ?? [],
      actions: createWritingActions({
        logger, paths: deps.paths, data: deps.data, project, recompile: deps.recompile, ...(deps.activeSource && { activeSource: deps.activeSource }),
        shownRoot: () => shownRoot() ?? project.main ?? "",
        problemsOf: (reported) => builds.problemsOf(project.folder, reported),
        reveal: context.reveal,
      }),
    }),
    onClosed: context.onClosed,
    ...(context.beside ? { show: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true } } : {}),
  };
}

// INVARIANT: covers every root's PDF, since one panel switches between roots without being recreated.
function previewRootDir(deps: BuildPreviewsDeps, project: ReadyProject): string {
  return project.settings.format === "typst" ? deps.data.projectBuildDir(project.settings.id) : project.folder;
}
