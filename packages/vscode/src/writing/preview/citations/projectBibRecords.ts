// Reads the .bib records of cite keys from the .bib files in a project folder, as the citation card shows them.
import * as path from "node:path";
import * as vscode from "vscode";

import { bibCardEntry, bibEntries, type CitationBibEntry } from "@labshelf/core";
import { currentText } from "./currentText.js";

/** The first record of each requested key across the folder's top-level .bib files. */
export async function projectBibRecords(projectFolder: string, keys: readonly string[]): Promise<Map<string, CitationBibEntry>> {
  const records = new Map<string, CitationBibEntry>();
  const listing = await vscode.workspace.fs.readDirectory(vscode.Uri.file(projectFolder));
  for (const [name, type] of listing) {
    if (type !== vscode.FileType.File || path.extname(name) !== ".bib") { continue; }
    for (const entry of bibEntries(await currentText(path.join(projectFolder, name)))) {
      if (keys.includes(entry.key) && !records.has(entry.key)) { records.set(entry.key, bibCardEntry(entry)); }
    }
  }
  return records;
}
