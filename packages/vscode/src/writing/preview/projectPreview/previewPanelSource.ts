// Assembles the reader source of a project's preview panel: its PDF, its paper and the ports that answer the reader.
import * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";
import type { ReaderPanel } from "../../../pdf-viewer/index.js";
import type { ReadyProject } from "../../mainDocument.js";
import { previewPaper, type BuildPreviewsDeps } from "../previewPanelInput.js";
import { createPreviewPorts } from "../previewPorts.js";
import { createPreviewStore } from "../previewStore.js";
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
  reveal: (file: string, line: number) => Promise<void>;
  onClosed: () => void;
  beside: boolean;
}

export function previewPanelSource(context: PreviewPanelContext): ReaderSource {
  const { deps, logger, project, pdf, builds, synctex, shownRoot } = context;
  return {
    key: `preview:${project.folder}`,
    paper: previewPaper(deps.paths, project, pdf),
    store: createPreviewStore(),
    pdfUri: vscode.Uri.file(pdf),
    rootDir: vscode.Uri.file(previewRootDir(deps, project)),
    preview: createPreviewPorts({
      bodyPages: context.bodyPages,
      logger, paths: deps.paths, projectFolder: project.folder, format: project.settings.format, listPapers: deps.listPapers,
      highlightsOf: deps.highlightsOf, citeSections: () => deps.citeSections(project, logger),
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
