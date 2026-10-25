/** Writes a paper resolved from the network or a captured page into a new folder, with its PDF when one was found. */
import { createCiteKey, deriveMetadataFields, PDF_FILE, createPaper, type MutationContext } from "../../library/index.js";
import type { PaperRecord, PdfVersion } from "../../model/index.js";
import type { ResolvedMetadata } from "../metadata/index.js";
import { NETWORK_IMPORT_MODULE } from "./env.js";

export interface ImportedPaper {
  /** The title is stored as given. */
  metadata: ResolvedMetadata & { title: string };
  pdf?: Uint8Array | undefined;
  /** Which version `pdf` is, when its source said so. */
  pdfVersion?: PdfVersion | undefined;
  /** Fields set on top of the metadata (an identifier the user typed, an abstract URL, the user's tags). */
  extra?: Partial<Pick<PaperRecord, "doi" | "url" | "tags" | "note">>;
  /** The cite key the paper asks for instead of the one built from its metadata. */
  citeKey?: string;
  /** The file name the sidecar records as the paper's source. */
  sourceName?: string;
  /** What the log line says, and the context that identifies the import. */
  log: { message: string; context: Record<string, unknown> };
}

/** @returns the stored record */
export async function writeImportedPaper(
  ctx: MutationContext,
  takenIds: Iterable<string>,
  targetDir: string,
  paper: ImportedPaper,
): Promise<PaperRecord> {
  const { metadata, pdf } = paper;
  const record = await createPaper(ctx, takenIds, targetDir, {
    citeKey: paper.citeKey ?? createCiteKey(metadata, metadata.title),
    fields: { title: metadata.title, ...deriveMetadataFields(metadata), ...paper.extra, ...(pdf && paper.pdfVersion ? { pdfVersion: paper.pdfVersion } : {}) },
    pdf,
    sourceName: paper.sourceName ?? PDF_FILE,
  });
  if (paper.citeKey && record.id !== paper.citeKey) {
    await ctx.logger.log("WARN", NETWORK_IMPORT_MODULE, "Requested cite key was taken", { requested: paper.citeKey, id: record.id });
  }
  await ctx.logger.log("INFO", NETWORK_IMPORT_MODULE, paper.log.message, {
    ...paper.log.context, id: record.id, withPdf: Boolean(pdf), pdfVersion: paper.pdfVersion, targetDir,
  });
  return record;
}
