// Opens the source line behind a point of the build preview, found through the project's SyncTeX data.
import * as path from "node:path";
import * as vscode from "vscode";

import { sourceAt, type ILogger, type PagePoint } from "@labshelf/core";
import { openSourceLine } from "./openSourceLine.js";
import { NOT_BUILT_MESSAGE, NO_SOURCE_MESSAGE, PREVIEW_LOG_MODULE, TYPST_SOURCE_LINKS_MESSAGE } from "../previewStrings.js";
import type { SynctexLookup } from "./projectSynctex.js";


export interface ShowSourceDeps {
  logger: ILogger;
  projectFolder: string;
  synctex: () => Promise<SynctexLookup>;
}

export async function showSource(deps: ShowSourceDeps, point: PagePoint): Promise<void> {
  const { logger, projectFolder } = deps;
  const lookup = await deps.synctex();
  if (lookup.status === "unsupported") {
    await vscode.window.showInformationMessage(TYPST_SOURCE_LINKS_MESSAGE);
    return;
  }
  if (lookup.status !== "found") {
    await logger.log("WARN", PREVIEW_LOG_MODULE, "No SyncTeX data for the preview", { projectFolder, page: point.page, reason: lookup.status });
    await vscode.window.showInformationMessage(NOT_BUILT_MESSAGE);
    return;
  }
  const source = sourceAt(lookup.index, point);
  if (!source) {
    await logger.log("WARN", PREVIEW_LOG_MODULE, "No source found at the clicked point", { projectFolder, page: point.page, x: point.x, y: point.y });
    await vscode.window.showInformationMessage(NO_SOURCE_MESSAGE);
    return;
  }
  try {
    await openSourceLine(source.file, source.line);
    await logger.log("INFO", PREVIEW_LOG_MODULE, "Opened source from the preview", { projectFolder, file: source.file, line: source.line, page: point.page });
  } catch (error) {
    await logger.error(PREVIEW_LOG_MODULE, error, { projectFolder, file: source.file, line: source.line, page: point.page });
    await vscode.window.showInformationMessage(`Could not open ${path.basename(source.file)}.`);
  }
}
