// Scrolls a build preview to the output of a source line, found through the project's SyncTeX data.
import * as vscode from "vscode";

import { pointFor, type ILogger, type PagePoint } from "@labshelf/core";
import { NOT_BUILT_MESSAGE, NOT_IN_PREVIEW_MESSAGE, PREVIEW_LOG_MODULE, TYPST_SOURCE_LINKS_MESSAGE } from "../previewStrings.js";
import type { SynctexLookup } from "./projectSynctex.js";

export interface RevealInPreviewDeps {
  logger: ILogger;
  projectFolder: string;
  synctex: () => Promise<SynctexLookup>;
  reveal: (point: PagePoint) => void;
}

/** `line` is 1-based. */
export async function revealInPreview(deps: RevealInPreviewDeps, file: string, line: number): Promise<void> {
  const { logger, projectFolder } = deps;
  const lookup = await deps.synctex();
  const point = lookup.status === "found" ? pointFor(lookup.index, file, line) : undefined;
  if (!point) {
    await logger.log("WARN", PREVIEW_LOG_MODULE, "No preview position for the source line", { projectFolder, file, line, reason: lookup.status });
    const message = lookup.status === "found" ? NOT_IN_PREVIEW_MESSAGE : lookup.status === "unsupported" ? TYPST_SOURCE_LINKS_MESSAGE : NOT_BUILT_MESSAGE;
    await vscode.window.showInformationMessage(message);
    return;
  }
  deps.reveal(point);
  await logger.log("INFO", PREVIEW_LOG_MODULE, "Revealed source line in the preview", { projectFolder, file, line, page: point.page });
}
