// Assembles the reader source of a project's preview panel: its PDF, its paper and the ports that answer the reader.
import * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";
import type { ReaderPanel } from "../../../pdf-viewer/index.js";
import type { CitationFixDeps } from "../citationFixes/index.js";
import type { ReadyProject } from "../../mainDocument.js";
import { previewPaper, type BuildPreviewsDeps } from "../previewPanelInput.js";
import { createPreviewPorts } from "../previewPorts.js";
import { PREVIEW_LOG_MODULE } from "../previewStrings.js";
import { createPreviewStore } from "../previewStore.js";
import { projectActions } from "../projectActions/index.js";
import { createWritingActions } from "../roots/index.js";
import type { ProjectSynctex } from "../sourceLinks/index.js";
import type { RootBuilds } from "./rootBuilds.js";

type ReaderSource = Parameters<typeof ReaderPanel.createOrShow>[1];

export interface PreviewPanelContext {
  deps: BuildPreviewsDeps;
  logger: ILogger;
  project: ReadyProject;
  pdf: string;
  builds: RootBuilds;
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
  return projectActions({
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
    paper: previewPaper(deps.paths, project, pdf),
    store: createPreviewStore(),
    pdfUri: deps.uriOf(pdf),
    rootDir: deps.uriOf(previewRootDir(deps, project)),
    preview: createPreviewPorts({
      bodyPages: context.bodyPages, fixes, ...(actions && { projectActions: actions }),
      logger, paths: deps.paths, projectFolder: project.folder, format: project.settings.format, listPapers: deps.listPapers,
      highlightsOf: deps.highlightsOf,
      synctex: () => synctex.load(project, shownRoot() ?? project.main),
      typstCites: () => builds.citesOf(project.folder, shownRoot() ?? project.main ?? "") ?? [],
      actions: createWritingActions({
        logger, paths: deps.paths, data: deps.data, project, recompile: deps.recompile,
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
