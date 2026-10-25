// Adds the paper a .bib entry describes to the library: imported by its DOI or arXiv id, or written from the entry's fields.

import * as vscode from "vscode";

import {
  extractArxivIdentifierFromUrl, createBibliographyCardEntry, extractDoi, normalizeArxivIdentifier, extractPlainField, createPaper,
  type BibEntry, type ILogger, type MutationContext,
} from "@labshelf/core";
import type { PaperImporter } from "../../../library/index.js";
import { findBibEntry } from "./projectBibliographyFiles.js";

const MODULE = "writing/preview";

export interface AddBibDeps {
  projectFolder: string;
  logger: ILogger;
  importer: Pick<PaperImporter, "importFromNetwork">;
  /** Where the library writes papers; the new paper lands in `ctx.papersRoot`. */
  ctx: MutationContext;
  /** The ids of the library's papers, so a new paper's folder never collides with one. */
  takenIds: () => string[];
  /** Puts the written paper in the index; the importer does the same for an import. */
  reindex: () => Promise<unknown>;
}

/** The DOI or arXiv id the entry names, in a form the importer takes. */
function identifierOf(entry: BibEntry): string | undefined {
  const field = (name: string): string => extractPlainField(entry.fields.get(name));
  const doi = extractDoi(field("doi"));
  if (doi) { return doi; }
  const arxiv = normalizeArxivIdentifier(field("eprint")) ?? extractArxivIdentifierFromUrl(field("url"));
  return arxiv ? `arXiv:${arxiv}` : undefined;
}

async function writeFromFields(deps: AddBibDeps, entry: BibEntry, file: string): Promise<string> {
  const card = createBibliographyCardEntry(entry);
  const url = extractPlainField(entry.fields.get("url"));
  const publisher = extractPlainField(entry.fields.get("publisher"));
  const record = await createPaper(deps.ctx, deps.takenIds(), deps.ctx.papersRoot, {
    citeKey: entry.key,
    fields: {
      title: card.title ?? entry.key,
      ...(card.authors.length > 0 ? { authors: card.authors } : {}),
      ...(card.year ? { year: card.year } : {}),
      ...(card.venue ? { journal: card.venue } : {}),
      ...(publisher ? { publisher } : {}),
      ...(url ? { url } : {}),
    },
    sourceName: file,
  });
  await deps.reindex();
  return record.id;
}

export async function addBibToLibrary(deps: AddBibDeps, key: string): Promise<void> {
  let file: string | undefined;
  try {
    const found = await findBibEntry(deps.projectFolder, key);
    if (!found) { throw new Error(`${key} is not in a .bib file of the project.`); }
    file = found.document.uri.fsPath;
    const input = identifierOf(found.entry);
    if (!input) {
      const id = await writeFromFields(deps, found.entry, deps.ctx.paths.basename(file));
      await deps.logger.log("INFO", MODULE, "Wrote a library paper from a .bib entry", { key, file, id });
      void vscode.window.showInformationMessage(`Added ${id} to the library from its .bib entry.`);
      return;
    }
    const outcome = await deps.importer.importFromNetwork(input, deps.ctx.papersRoot, { citeKey: key });
    if (outcome.status === "failed") { throw new Error(outcome.error); }
    if (outcome.status === "skipped") { throw new Error(`${input} is not an identifier the importer takes.`); }
    await deps.logger.log("INFO", MODULE, "Imported a library paper for a .bib entry", { key, file, input, status: outcome.status });
    void vscode.window.showInformationMessage(
      outcome.status === "duplicate" ? `${key} is already in the library as ${outcome.existingId}.` : `Added ${key} to the library.`,
    );
  } catch (error) {
    await deps.logger.error(MODULE, error, { key, file, action: "add-bib-to-library" });
    void vscode.window.showErrorMessage(`Could not add ${key} to the library: ${error instanceof Error ? error.message : String(error)}`);
  }
}
