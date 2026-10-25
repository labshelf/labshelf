// Replaces a preprint entry in the user's .bib with its published version, and tells which venue that is.
import * as vscode from "vscode";

import { checkBibliography, type BibliographyFix, type ILogger, type PublishedVersion, type PublishedVersionFinder } from "@labshelf/core";
import { findBibEntry } from "./projectBibliographyFiles.js";

const MODULE = "writing/preview";

export interface UpdateBibliographyDeps {
  projectFolder: string;
  logger: ILogger;
  publishedLookup: PublishedVersionFinder;
}

interface PublishedFix {
  document: vscode.TextDocument;
  fix: BibliographyFix | undefined;
  version: PublishedVersion | undefined;
}

// Lints the entry alone: one lookup instead of one per entry in the file, and the lookup's answer is the entry's own.
async function publishedFixOf(deps: UpdateBibliographyDeps, key: string): Promise<PublishedFix | undefined> {
  const found = await findBibEntry(deps.projectFolder, key);
  if (!found) { return undefined; }
  const { document, entry } = found;
  let version: PublishedVersion | undefined;
  const findings = await checkBibliography(document.getText().slice(entry.start, entry.end), async (preprint) => {
    version = await deps.publishedLookup(preprint);
    return version;
  });
  const fix = findings.find((finding) => finding.rule === "published-version")?.fix;
  return { document, version, fix: fix && { ...fix, start: fix.start + entry.start, end: fix.end + entry.start } };
}

/** The journal the preprint was published in; undefined when it has no known published version or the lookup fails. */
export async function readPublishedVenue(deps: UpdateBibliographyDeps, key: string): Promise<string | undefined> {
  try {
    return (await publishedFixOf(deps, key))?.version?.record?.journal;
  } catch (error) {
    await deps.logger.error(MODULE, error, { key, projectFolder: deps.projectFolder, action: "published-venue" });
    return undefined;
  }
}

/** Edits the entry in its open document, so the source shows it as changed and the user can undo or save it. */
export async function updateBibEntry(deps: UpdateBibliographyDeps, key: string): Promise<void> {
  let file: string | undefined;
  try {
    const found = await publishedFixOf(deps, key);
    file = found?.document.uri.fsPath;
    if (!found?.fix) {
      await fail(deps, key, file, new Error(`No published version of ${key} is recorded in a .bib file of the project.`));
      return;
    }
    const { document, fix } = found;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(fix.start), document.positionAt(fix.end)), fix.text);
    if (!(await vscode.workspace.applyEdit(edit))) { throw new Error(`VS Code refused the edit to ${file}.`); }
    await deps.logger.log("INFO", MODULE, "Replaced a preprint .bib entry with its published version", { key, file });
  } catch (error) {
    await fail(deps, key, file, error);
  }
}

async function fail(deps: UpdateBibliographyDeps, key: string, file: string | undefined, error: unknown): Promise<void> {
  await deps.logger.error(MODULE, error, { key, file, action: "update-bib-entry" });
  void vscode.window.showErrorMessage(`Could not update ${key}: ${error instanceof Error ? error.message : String(error)}`);
}
