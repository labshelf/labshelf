/** Imports one PDF file as a paper: <targetDir>/<citeKey>/paper.pdf with metadata.yaml and bib.bib beside it. */
import type { PaperRecord } from "../../../model/index.js";
import { citeKeySlug } from "../../paper/index.js";
import { errorMessage } from "../../../logging/index.js";
import { MUTATIONS_MODULE, type MutationContext } from "../mutationDeps.js";
import { metadataFields, needsReview, type ParsedImport } from "./importedPaperRecord.js";
import { writeNewPaper } from "./createPaper.js";
import { isPdfBytes } from "./pdfBytes.js";

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
export function doiLookup(papers: Iterable<Pick<PaperRecord, "id" | "doi">>): (doi: string) => string | undefined {
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
    const stem = fileStem(ctx.paths.basename(input));
    const parsed = await deps.parse(bytes, stem);
    // A PDF backend that transfers the buffer it parses leaves it empty: writing it would store a zero-byte paper.pdf.
    if (bytes.byteLength === 0) {
      throw new Error("PDF buffer was consumed during parsing; the file could not be copied into the library.");
    }
    const existingId = parsed.doi ? deps.findByDoi(parsed.doi) : undefined;
    if (existingId) { return { status: "duplicate", existingId, input }; }

    const record = await writeNewPaper(ctx, deps.takenIds(), targetDir, {
      citeKey: parsed.citeKey || citeKeySlug(stem) || `paper${Date.now()}`,
      fields: { title: parsed.title, ...metadataFields(parsed) },
      pdf: bytes,
      sourceName: input,
    });
    const { id } = record;
    await ctx.logger.log("INFO", MUTATIONS_MODULE, "Paper imported from PDF", {
      id, source: parsed.source, confidence: parsed.confidence, targetDir,
    });
    return { status: "added", record, needsReview: needsReview(parsed), input };
  } catch (error) {
    await ctx.logger.log("WARN", MUTATIONS_MODULE, "PDF import failed", { file, message: errorMessage(error) });
    return { status: "failed", error: errorMessage(error), input };
  }
}

// The name without its extension; a leading dot belongs to the name.
function fileStem(name: string): string {
  return name.replace(/(?<=.)\.[^.]*$/, "");
}
