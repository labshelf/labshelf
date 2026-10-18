// Adds a review note from the build preview as a comment thread at the source line SyncTeX finds behind its point.
import * as vscode from "vscode";

import { sourceAt, type PagePoint } from "@labshelf/core";
import { addSourceComment } from "../../../collab/comments/index.js";
import { NOT_BUILT_MESSAGE, PREVIEW_LOG_MODULE } from "../previewStrings.js";
import { openSourceLine } from "./openSourceLine.js";
import type { ShowSourceDeps } from "./showSource.js";

const TYPST_REVIEW_MESSAGE = "Review notes become comments in LaTeX projects; in a Typst project, comment on the source in the editor.";
const NO_SOURCE_LINE_MESSAGE = "No source line found for this text, so the note was not added. Comment on the source in the editor.";

export async function addReviewComment(deps: ShowSourceDeps, point: PagePoint, quote: string, note: string): Promise<void> {
  const { logger, projectFolder } = deps;
  const context = { projectFolder, page: point.page, x: point.x, y: point.y };
  const lookup = await deps.synctex();
  if (lookup.status === "unsupported") {
    await logger.log("WARN", PREVIEW_LOG_MODULE, "A review note in a project without SyncTeX was not added", context);
    void vscode.window.showInformationMessage(TYPST_REVIEW_MESSAGE);
    return;
  }
  const source = lookup.status === "found" ? sourceAt(lookup.index, point) : undefined;
  if (!source) {
    await logger.log("WARN", PREVIEW_LOG_MODULE, "No source found for a review note", { ...context, reason: lookup.status === "found" ? "no hit" : lookup.status });
    void vscode.window.showInformationMessage(lookup.status === "found" ? NO_SOURCE_LINE_MESSAGE : NOT_BUILT_MESSAGE);
    return;
  }
  try {
    await addSourceComment({ projectFolder, file: source.file, line: source.line, quote, body: note });
    await openSourceLine(source.file, source.line);
  } catch (error) {
    await logger.error(PREVIEW_LOG_MODULE, error, { ...context, action: "add a review note", file: source.file, line: source.line });
    void vscode.window.showErrorMessage(`LabShelf could not add the note to ${deps.paths.basename(source.file)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
