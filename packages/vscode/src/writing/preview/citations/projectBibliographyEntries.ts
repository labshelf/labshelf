// Reads the .bib records of cite keys from the user's .bib files in a project folder, as the citation card shows them.
import { bibCardEntry, bibEntries, type CitationBibEntry } from "@labshelf/core";
import { userBibFiles } from "./projectBibliographyFiles.js";

/** The first record of each requested key across the project's user-written .bib files. */
export async function projectBibRecords(projectFolder: string, keys: readonly string[]): Promise<Map<string, CitationBibEntry>> {
  const records = new Map<string, CitationBibEntry>();
  for (const document of await userBibFiles(projectFolder)) {
    for (const entry of bibEntries(document.getText())) {
      if (keys.includes(entry.key) && !records.has(entry.key)) { records.set(entry.key, bibCardEntry(entry)); }
    }
  }
  return records;
}
