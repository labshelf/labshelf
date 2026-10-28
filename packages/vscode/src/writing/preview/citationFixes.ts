// Fixes the citation cards offer: replace a missing key, add a .bib entry to the library or update a preprint entry to its published venue.
import * as vscode from "vscode";

import {
  extractArxivIdentifierFromUrl, createBibliographyCardEntry, extractDoi, normalizeArxivIdentifier, readBibField, createPaper,
  deriveSuggestedCiteKey, formatError, checkBibliography, BIBLIOGRAPHY_HEADER, parseBibEntries,
  type BibEntry, type BibliographyFix, type CitationCardFix, type CitationEntry, type CitationFix, type ILogger, type MutationContext,
  type PathOps, type PublishedVersion, type PublishedVersionFinder,
} from "@labshelf/core";
import type { PaperImporter } from "../../library/index.js";
import { PREVIEW_LOG_MODULE } from "./panel.js";

interface ProjectBibEntry {
  document: vscode.TextDocument;
  entry: BibEntry;
}

/** The project's top-level and nested `.bib` documents the user writes, in the order the workspace lists them; the generated file is left out. */
export async function listUserBibliographyFiles(projectFolder: string): Promise<vscode.TextDocument[]> {
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(projectFolder), "**/*.bib"));
  const documents: vscode.TextDocument[] = [];
  for (const file of files) {
    const document = await vscode.workspace.openTextDocument(file);
    // The generated file is told apart by its header, not its name, because the name is a setting.
    if (!document.getText().startsWith(BIBLIOGRAPHY_HEADER)) { documents.push(document); }
  }
  return documents;
}

/** The first entry with `key` in the user's `.bib` files. */
async function findBibEntry(projectFolder: string, key: string): Promise<ProjectBibEntry | undefined> {
  for (const document of await listUserBibliographyFiles(projectFolder)) {
    const entry = parseBibEntries(document.getText()).find((candidate) => candidate.key === key);
    if (entry) { return { document, entry }; }
  }
  return undefined;
}

interface ReplaceCiteKeyDeps {
  projectFolder: string;
  paths: PathOps;
  logger: ILogger;
}

const LATEX_CITE = /\\[A-Za-z]*cite[A-Za-z]*\*?(?:\s*\[[^\]]*\])*\s*\{([^}]*)\}/g;

/** Column range of `key` inside a LaTeX cite argument list or as a Typst `@key` / `<key>`. */
function keyRange(line: string, key: string): [number, number] | undefined {
  for (const cite of line.matchAll(LATEX_CITE)) {
    const keys = cite[1] ?? "";
    const listStart = cite.index + cite[0].length - 1 - keys.length;
    for (const item of keys.matchAll(/[^,\s]+/g)) {
      if (item[0] === key) { return [listStart + item.index, listStart + item.index + key.length]; }
    }
  }
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const typst = new RegExp(`(?<![\\w@])(?:@|<)(${escaped})(?![\\w:-])`).exec(line);
  return typst ? [typst.index + 1, typst.index + 1 + key.length] : undefined;
}

/** Replaces one cited key on a source line, leaving the other keys of the same cite untouched. */
export async function updateCiteKey(deps: ReplaceCiteKeyDeps, fix: Extract<CitationFix, { kind: "replace" }>): Promise<void> {
  const uri = vscode.Uri.file(deps.paths.join(deps.projectFolder, fix.file));
  const document = await vscode.workspace.openTextDocument(uri);
  const lineIndex = fix.line - 1;
  const range = lineIndex >= 0 && lineIndex < document.lineCount ? keyRange(document.lineAt(lineIndex).text, fix.key) : undefined;
  if (!range) {
    await deps.logger.log("WARN", PREVIEW_LOG_MODULE, "Cited key not found on the line to fix", { file: fix.file, line: fix.line, key: fix.key });
    void vscode.window.showWarningMessage(`Could not find the citation "${fix.key}" at ${fix.file}:${fix.line}.`);
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(lineIndex, range[0], lineIndex, range[1]), fix.replacement);
  await vscode.workspace.applyEdit(edit);
}

interface UpdateBibliographyDeps {
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
    await deps.logger.error(PREVIEW_LOG_MODULE, error, { key, projectFolder: deps.projectFolder, action: "published-venue" });
    return undefined;
  }
}

/** Replaces a preprint entry in the user's .bib with its published version, editing the entry in its open document, so the source shows it as changed and the user can undo or save it. */
export async function updateBibEntry(deps: UpdateBibliographyDeps, key: string): Promise<void> {
  let file: string | undefined;
  try {
    const found = await publishedFixOf(deps, key);
    file = found?.document.uri.fsPath;
    if (!found?.fix) {
      await failUpdate(deps, key, file, new Error(`No published version of ${key} is recorded in a .bib file of the project.`));
      return;
    }
    const { document, fix } = found;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(fix.start), document.positionAt(fix.end)), fix.text);
    if (!(await vscode.workspace.applyEdit(edit))) { throw new Error(`VS Code refused the edit to ${file}.`); }
    await deps.logger.log("INFO", PREVIEW_LOG_MODULE, "Replaced a preprint .bib entry with its published version", { key, file });
  } catch (error) {
    await failUpdate(deps, key, file, error);
  }
}

async function failUpdate(deps: UpdateBibliographyDeps, key: string, file: string | undefined, error: unknown): Promise<void> {
  await deps.logger.error(PREVIEW_LOG_MODULE, error, { key, file, action: "update-bib-entry" });
  void vscode.window.showErrorMessage(`Could not update ${key}: ${formatError(error)}`);
}

interface AddBibliographyDeps {
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
  const doi = extractDoi(readBibField(entry, "doi"));
  if (doi) { return doi; }
  const arxiv = normalizeArxivIdentifier(readBibField(entry, "eprint")) ?? extractArxivIdentifierFromUrl(readBibField(entry, "url"));
  return arxiv ? `arXiv:${arxiv}` : undefined;
}

async function writeFromFields(deps: AddBibliographyDeps, entry: BibEntry, file: string): Promise<string> {
  const card = createBibliographyCardEntry(entry);
  const url = readBibField(entry, "url");
  const publisher = readBibField(entry, "publisher");
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

/** Adds the paper a .bib entry describes to the library: imported by its DOI or arXiv id, or written from the entry's fields. */
export async function addBibliographyToLibrary(deps: AddBibliographyDeps, key: string): Promise<void> {
  let file: string | undefined;
  try {
    const found = await findBibEntry(deps.projectFolder, key);
    if (!found) { throw new Error(`${key} is not in a .bib file of the project.`); }
    file = found.document.uri.fsPath;
    const input = identifierOf(found.entry);
    if (!input) {
      const id = await writeFromFields(deps, found.entry, deps.ctx.paths.basename(file));
      await deps.logger.log("INFO", PREVIEW_LOG_MODULE, "Wrote a library paper from a .bib entry", { key, file, id });
      void vscode.window.showInformationMessage(`Added ${id} to the library from its .bib entry.`);
      return;
    }
    const outcome = await deps.importer.importFromNetwork(input, deps.ctx.papersRoot, { citeKey: key });
    if (outcome.status === "failed") { throw new Error(outcome.error); }
    if (outcome.status === "skipped") { throw new Error(`${input} is not an identifier the importer takes.`); }
    await deps.logger.log("INFO", PREVIEW_LOG_MODULE, "Imported a library paper for a .bib entry", { key, file, input, status: outcome.status });
    void vscode.window.showInformationMessage(
      outcome.status === "duplicate" ? `${key} is already in the library as ${outcome.existingId}.` : `Added ${key} to the library.`,
    );
  } catch (error) {
    await deps.logger.error(PREVIEW_LOG_MODULE, error, { key, file, action: "add-bib-to-library" });
    void vscode.window.showErrorMessage(`Could not add ${key} to the library: ${formatError(error)}`);
  }
}

/** Declares what the citation-card fixes need from the extension. */
export type CitationFixDeps = UpdateBibliographyDeps & AddBibliographyDeps & ReplaceCiteKeyDeps & {
  /** Keys of the library papers, with the authors and year that rank look-alikes. */
  shelfKeys: () => Promise<{ key: string; authors: string[]; year?: string }[]>;
};

/** Runs the fix a citation card asked for and reports a failure to the user. */
export async function applyCitationFix(deps: CitationFixDeps, fix: CitationFix): Promise<void> {
  try {
    if (fix.kind === "replace") { await updateCiteKey(deps, fix); }
    else if (fix.kind === "update") { await updateBibEntry(deps, fix.key); }
    else { await addBibliographyToLibrary(deps, fix.key); }
  } catch (error) {
    await deps.logger.error(PREVIEW_LOG_MODULE, error, { kind: fix.kind, key: fix.key });
    void vscode.window.showErrorMessage(`Could not fix the citation "${fix.key}": ${formatError(error)}`);
  }
}

async function fixOf(deps: CitationFixDeps, entry: CitationEntry): Promise<CitationCardFix | undefined> {
  if (!entry.paper && !entry.bib) {
    const suggestion = deriveSuggestedCiteKey(entry.key, await deps.shelfKeys());
    return suggestion ? { kind: "replace", suggestion } : undefined;
  }
  if (entry.bib && !entry.paper) { return { kind: "add" }; }
  if (!entry.bib) { return undefined; }
  const venue = await readPublishedVenue(deps, entry.key);
  return venue ? { kind: "update", venue } : undefined;
}

/** Attaches to each citation card the fix that suits it: replace a missing key, add a bib entry or update its venue. */
export function withCitationFixes(deps: CitationFixDeps, entries: CitationEntry[]): Promise<CitationEntry[]> {
  return Promise.all(entries.map(async (entry) => {
    try {
      const fix = await fixOf(deps, entry);
      return fix ? { ...entry, fix } : entry;
    } catch (error) {
      await deps.logger.log("WARN", PREVIEW_LOG_MODULE, "Citation fix lookup failed", { key: entry.key, error: String(error) });
      return entry;
    }
  }));
}
