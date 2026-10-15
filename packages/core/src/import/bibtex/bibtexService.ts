/**
 * Writes a paper's metadata.yaml and bib.bib through an injected IFileSystem on POSIX-style paths, so it runs
 * against vscode.workspace.fs and the IndexedDB filesystem alike.
 */
import YAML from "yaml";

import type { IFileSystem } from "../../ports/index.js";
import type { PaperRecord } from "../../model/index.js";
import { PDF_FILE, joinWith, paperFiles } from "../../library/index.js";
import { bibtexEntry } from "./bibtexEntry.js";

const posixJoin = joinWith("/");

// Returns the trailing name of a path, accepting both POSIX and Windows separators.
function baseName(p: string): string {
  const lastSlash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return lastSlash < 0 ? p : p.slice(lastSlash + 1);
}

// Keys writePaperArtifacts derives from the PaperRecord on every write.
const OWNED_KEYS = new Set([
  "title", "authors", "year", "path", "citekey", "status", "source", "journal", "publisher", "volume",
  "issue", "pages", "doi", "url", "issn", "language", "keywords", "summary", "textLayer",
]);

// Rewrites after import pass the library's own copy, "paper.pdf", which says
// nothing; the name the user imported is kept from the existing file.
function sourceName(existing: Record<string, unknown>, sourceFileName: string): string {
  const given = baseName(sourceFileName);
  if (given !== PDF_FILE) {
    return given;
  }
  const kept = existing["source"];
  return typeof kept === "string" && kept ? kept : given;
}

// The sidecar keys derived from the record; optional fields are written only when set.
function metadataFromRecord(paper: PaperRecord, source: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    title: paper.title,
    authors: paper.authors ?? [],
    year: paper.year ?? null,
    path: paper.path,
    citekey: paper.citeKey,
    status: paper.status,
    source,
  };

  if (paper.journal) { metadata["journal"] = paper.journal; }
  if (paper.publisher) { metadata["publisher"] = paper.publisher; }
  if (paper.volume) { metadata["volume"] = paper.volume; }
  if (paper.issue) { metadata["issue"] = paper.issue; }
  if (paper.pages) { metadata["pages"] = paper.pages; }
  if (paper.doi) { metadata["doi"] = paper.doi; }
  if (paper.url) { metadata["url"] = paper.url; }
  if (paper.issn) { metadata["issn"] = paper.issn; }
  if (paper.language) { metadata["language"] = paper.language; }
  // metadata.yaml is what the index is rebuilt from on every activation, so
  // a field left out here is a field silently dropped on the next start.
  if (paper.keywords?.length) { metadata["keywords"] = paper.keywords; }
  if (paper.summary) { metadata["summary"] = paper.summary; }
  if (paper.textLayer) { metadata["textLayer"] = paper.textLayer; }
  return metadata;
}

// Keys this service does not derive from the record (the browser's tags and
// note, a hand edit) belong to whoever wrote them, so a rewrite from a
// surface that does not know them — the VS Code index has no tag column —
// carries them over instead of deleting them.
function carryOverUserKeys(metadata: Record<string, unknown>, paper: PaperRecord, existing: Record<string, unknown>): void {
  const carried = Object.fromEntries(Object.entries(existing).filter(([key]) => !OWNED_KEYS.has(key)));
  if (paper.tags !== undefined) {
    delete carried["tags"];
    if (paper.tags.length) { metadata["tags"] = paper.tags; }
  }
  if (paper.note !== undefined) {
    delete carried["note"];
    if (paper.note.trim()) { metadata["note"] = paper.note; }
  }
  Object.assign(metadata, carried);
}

/** Generates and writes metadata.yaml and bib.bib sidecar files for a paper. */
export class BibTeXService {
  constructor(private readonly fs: IFileSystem) {}

  /**
   * Writes metadata.yaml and bib.bib into the paper folder.
   * @returns void
   */
  async writePaperArtifacts(paperFolder: string, paper: PaperRecord, sourceFileName: string): Promise<void> {
    const { metadata: metadataPath, bib: bibPath } = paperFiles(paperFolder, posixJoin);
    const existing = await this.readExisting(metadataPath);

    const metadata = metadataFromRecord(paper, sourceName(existing, sourceFileName));
    carryOverUserKeys(metadata, paper, existing);

    // The bib `file` line must only point at a PDF that is actually on disk:
    // the browser writes a reference without paper.pdf when it finds none, so a
    // blind `file = {…/paper.pdf}` would send LaTeX and reference tools to a
    // file that is not there. Decide from the folder, not from the record.
    const pdfExists = await this.fs.exists(paperFiles(paperFolder, posixJoin).pdf);
    await this.fs.writeText(metadataPath, YAML.stringify(metadata));
    await this.fs.writeText(bibPath, bibtexEntry(paper, { includeFile: pdfExists }));
  }

  // The current sidecar as a plain object; empty when absent or unreadable,
  // since an unreadable sidecar is about to be replaced anyway.
  private async readExisting(metadataPath: string): Promise<Record<string, unknown>> {
    try {
      if (!(await this.fs.exists(metadataPath))) {
        return {};
      }
      const parsed = YAML.parse(await this.fs.readText(metadataPath)) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
}
