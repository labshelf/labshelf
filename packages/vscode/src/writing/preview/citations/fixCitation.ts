// Runs the fix a citation card asked for and reports a failure to the user.
import * as vscode from "vscode";

import type { CitationFix } from "@labshelf/core";
import { PREVIEW_LOG_MODULE } from "../previewStrings.js";
import { addBibToLibrary } from "./addBibliographyToLibrary.js";
import type { CitationFixDeps } from "./citationFixDeps.js";
import { replaceCitedKey } from "./replaceCiteKey.js";
import { updateBibEntry } from "./updateBibEntry.js";

export async function fixCitation(deps: CitationFixDeps, fix: CitationFix): Promise<void> {
  try {
    if (fix.kind === "replace") { await replaceCitedKey(deps, fix); }
    else if (fix.kind === "update") { await updateBibEntry(deps, fix.key); }
    else { await addBibToLibrary(deps, fix.key); }
  } catch (error) {
    await deps.logger.error(PREVIEW_LOG_MODULE, error, { kind: fix.kind, key: fix.key });
    void vscode.window.showErrorMessage(`Could not fix the citation "${fix.key}": ${error instanceof Error ? error.message : String(error)}`);
  }
}
