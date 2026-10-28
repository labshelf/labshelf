/**
 * Imports PDFs as papers: <targetDir>/<citeKey>/paper.pdf with metadata.yaml and bib.bib beside it. Covers the records
 * built from bibliographic metadata, the import itself, batches that see the ids and DOIs earlier files took, imports of
 * picked files and folders, and the summary message every app shows afterwards.
 */
import { BIBLIOGRAPHIC_STRING_FIELDS, type BibliographicFields, type PaperRecord } from "../../model/index.js";
import { formatError } from "../../errors/index.js";
import { stemOf } from "../../path/index.js";
import { deriveCiteKeySlug, ensureCiteKey } from "../citeKey.js";
import { PDF_FILE } from "../layout.js";
import type { MutationContext } from "./paperRecordWrite.js";
import { MUTATIONS_MODULE, findPdfsToImport } from "./folderReads.js";

/** The bibliographic fields a record takes; the io PDF parser's and registries' results satisfy it. */
export interface PaperRecordMetadata extends BibliographicFields {
  title?: string | undefined;
}

/** What an import needs from parsing a PDF; `PdfImportParser.parse` returns a superset. */
export interface ParsedImport extends PaperRecordMetadata {
  title: string;
  citeKey: string;
  confidence?: string | undefined;
  source?: string | undefined;
}

/** @returns the non-empty bibliographic fields of `meta`, without the title */
export function deriveMetadataFields(meta: PaperRecordMetadata): Partial<PaperRecord> {
  const out: Partial<PaperRecord> = {};
  if (meta.authors?.length) { out.authors = meta.authors; }
  if (meta.year) { out.year = meta.year; }
  for (const key of BIBLIOGRAPHIC_STRING_FIELDS) {
    const value = meta[key];
    if (value) { out[key] = value; }
  }
  if (meta.keywords?.length) { out.keywords = meta.keywords; }
  return out;
}

/**
 * Overwrites a record's bibliographic fields with resolved ones. Identity fields stay: the folder is named after the
 * cite key.
 * @returns the updated record
 */
export function withResolvedMetadata(record: PaperRecord, meta: PaperRecordMetadata): PaperRecord {
  return { ...record, ...(meta.title ? { title: meta.title } : {}), ...deriveMetadataFields(meta) };
}

/**
 * A record is worth reviewing when no registry confirmed it: the title and authors then come from the PDF's own
 * layout or its file name.
 * @returns true when the user should check the metadata
 */
export function isLowConfidenceImport(parsed: Pick<ParsedImport, "confidence" | "doi">): boolean {
  return parsed.confidence !== "high" && !parsed.doi;
}

// A PDF: the "%PDF-" header must be the first five bytes, as the importer and the parser require.
const HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d];

export function isPdfBytes(bytes: Uint8Array): boolean {
  return HEADER.every((byte, index) => bytes[index] === byte);
}

export interface CreatePaperInput {
  /** The key the paper wants; a taken one gets a letter suffix. */
  citeKey: string;
  /** Everything the record holds besides its identity, folder, status and PDF flag. */
  fields: Omit<PaperRecord, "id" | "citeKey" | "path" | "status" | "hasPdf">;
  pdf?: Uint8Array | undefined;
  /** The file name the metadata records as the paper's source. */
  sourceName: string;
}

/**
 * No explicit mkdir: every adapter's writeFile creates the folder, and the browser store's mkdir would leave a stray `.keep`
 * marker.
 * @returns the stored record
 */
export async function createPaper(
  ctx: MutationContext,
  takenIds: Iterable<string>,
  targetDir: string,
  paper: CreatePaperInput,
): Promise<PaperRecord> {
  // The id is also the folder name: a taken one would overwrite another paper's PDF.
  const id = await ensureCiteKey(paper.citeKey, takenIds, (key) => ctx.fs.exists(ctx.paths.join(targetDir, key)));
  const folder = ctx.paths.join(targetDir, id);
  if (paper.pdf) { await ctx.fs.writeFile(ctx.paths.join(folder, PDF_FILE), paper.pdf); }
  const record: PaperRecord = { id, path: folder, citeKey: id, status: "unread", hasPdf: Boolean(paper.pdf), ...paper.fields };
  const { hasPdf: _hasPdf, ...stored } = record;
  await ctx.artifacts.writePaperArtifacts(folder, stored, paper.sourceName);
  return record;
}

export type PdfParse = (bytes: Uint8Array, fileStem: string) => Promise<ParsedImport>;

/** What an import needs from the app: the parser and what its index knows about the library. */
export interface ImportDeps {
  parse: PdfParse;
  /** @returns the id of the paper with this DOI, compared ignoring case (see `doiLookup`) */
  findByDoi(doi: string): string | undefined;
  /** Every paper id the app knows; a new cite key avoids them, ignoring case. */
  takenIds(): Iterable<string>;
}

export type ImportOutcome =
  | { status: "added"; record: PaperRecord; needsReview: boolean; input: string }
  | { status: "duplicate"; existingId: string; input: string }
  | { status: "failed"; error: string; input: string }
  | { status: "skipped"; input: string };

export interface ImportOptions {
  /** The name the user knows the file by, when `file` is a download in a temp folder. */
  sourceName?: string;
}

/** @returns a findByDoi over the papers an app knows, ignoring case */
export function createDoiFinder(papers: Iterable<Pick<PaperRecord, "id" | "doi">>): (doi: string) => string | undefined {
  const byDoi = new Map<string, string>();
  for (const paper of papers) {
    if (paper.doi && !byDoi.has(paper.doi.toLowerCase())) { byDoi.set(paper.doi.toLowerCase(), paper.id); }
  }
  return (doi) => byDoi.get(doi.toLowerCase());
}

/** @returns what happened; failures are logged and returned, never thrown */
export async function importPdf(
  ctx: MutationContext,
  deps: ImportDeps,
  file: string,
  targetDir: string,
  options: ImportOptions = {},
): Promise<ImportOutcome> {
  const input = options.sourceName ?? file;
  try {
    const bytes = await ctx.fs.readFile(file);
    if (!isPdfBytes(bytes)) { throw new Error("Not a PDF file"); }
    const stem = stemOf(ctx.paths.basename(input));
    const parsed = await deps.parse(bytes, stem);
    // A PDF backend that transfers the buffer it parses leaves it empty: writing it would store a zero-byte paper.pdf.
    if (bytes.byteLength === 0) {
      throw new Error("PDF buffer was consumed during parsing; the file could not be copied into the library.");
    }
    const existingId = parsed.doi ? deps.findByDoi(parsed.doi) : undefined;
    if (existingId) { return { status: "duplicate", existingId, input }; }

    const record = await createPaper(ctx, deps.takenIds(), targetDir, {
      citeKey: parsed.citeKey || deriveCiteKeySlug(stem) || `paper${Date.now()}`,
      fields: { title: parsed.title, ...deriveMetadataFields(parsed) },
      pdf: bytes,
      sourceName: input,
    });
    const { id } = record;
    await ctx.logger.log("INFO", MUTATIONS_MODULE, "Paper imported from PDF", {
      id, source: parsed.source, confidence: parsed.confidence, targetDir,
    });
    return { status: "added", record, needsReview: isLowConfidenceImport(parsed), input };
  } catch (error) {
    await ctx.logger.log("WARN", MUTATIONS_MODULE, "PDF import failed", { file, message: formatError(error) });
    return { status: "failed", error: formatError(error), input };
  }
}

export interface ImportProgress {
  /** 1-based position of the file about to be imported. */
  index: number;
  total: number;
  input: string;
}

export interface ImportHooks {
  /** Called just before each file is imported. */
  onProgress?: (progress: ImportProgress) => void;
  /** Called as each file finishes, so the app can show a paper before the batch ends; awaited before the next file. */
  onOutcome?: (outcome: ImportOutcome) => void | Promise<void>;
}

/** @returns one outcome per file, in order */
export async function importPdfs(
  ctx: MutationContext,
  deps: ImportDeps,
  files: string[],
  targetDir: string,
  hooks: ImportHooks = {},
): Promise<ImportOutcome[]> {
  const claimedIds: string[] = [];
  const claimedDois = new Map<string, string>();
  const batchDeps: ImportDeps = {
    parse: deps.parse,
    findByDoi: (doi) => deps.findByDoi(doi) ?? claimedDois.get(doi.toLowerCase()),
    takenIds: () => [...deps.takenIds(), ...claimedIds],
  };
  const outcomes: ImportOutcome[] = [];
  for (const [position, file] of files.entries()) {
    hooks.onProgress?.({ index: position + 1, total: files.length, input: file });
    const outcome = await importPdf(ctx, batchDeps, file, targetDir);
    if (outcome.status === "added") {
      claimedIds.push(outcome.record.id);
      if (outcome.record.doi) { claimedDois.set(outcome.record.doi.toLowerCase(), outcome.record.id); }
    }
    outcomes.push(outcome);
    await hooks.onOutcome?.(outcome);
  }
  return outcomes;
}

/**
 * Imports picked files and folders: folders are searched for PDFs, and inputs that are neither file nor folder come
 * back as skipped (after the PDFs, without an onOutcome call).
 * @returns one outcome per PDF found, then one per skipped input
 */
export async function importPaths(
  ctx: MutationContext,
  deps: ImportDeps,
  inputs: string[],
  targetDir: string,
  hooks: ImportHooks = {},
): Promise<ImportOutcome[]> {
  const { pdfs, skipped } = await findPdfsToImport(ctx, inputs);
  const outcomes = await importPdfs(ctx, deps, pdfs, targetDir, hooks);
  return [...outcomes, ...skipped.map((input): ImportOutcome => ({ status: "skipped", input }))];
}

// Words the one message every app shows after an import, from its outcomes.

export interface ImportCounts {
  level: "info" | "warn";
  text: string;
  /** The paper the app should select: the one added, or the one a lone duplicate matched. */
  reveal?: string;
}

type Outcome<S extends ImportOutcome["status"]> = Extract<ImportOutcome, { status: S }>;

function withStatus<S extends ImportOutcome["status"]>(outcomes: ImportOutcome[], status: S): Array<Outcome<S>> {
  return outcomes.filter((outcome): outcome is Outcome<S> => outcome.status === status);
}

/** @returns the summary; apps add their own prefix or shorten the title */
export function countImportOutcomes(outcomes: ImportOutcome[]): ImportCounts {
  const added = withStatus(outcomes, "added");
  const duplicates = withStatus(outcomes, "duplicate");
  const skipped = withStatus(outcomes, "skipped");
  const failed = withStatus(outcomes, "failed");
  if (!added.length && !duplicates.length && !failed.length) { return { level: "warn", text: "No PDF found there" }; }
  const alone = outcomes.length === 1;
  if (alone && added[0]) {
    const { record, needsReview } = added[0];
    const review = needsReview ? " — metadata unconfirmed, check it" : "";
    return { level: "info", text: `Added "${record.title}"${review}`, reveal: record.id };
  }
  if (alone && duplicates[0]) {
    const { existingId } = duplicates[0];
    return { level: "warn", text: `Already in the library as ${existingId}`, reveal: existingId };
  }
  const parts = [`${added.length} added`];
  if (duplicates.length) { parts.push(`${duplicates.length} already in the library`); }
  if (skipped.length) { parts.push(`${skipped.length} skipped`); }
  if (failed[0]) { parts.push(`${failed.length} failed: ${failed[0].error}`); }
  return { level: failed.length ? "warn" : "info", text: parts.join(", ") };
}
