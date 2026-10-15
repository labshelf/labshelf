/** Writes a paper resolved from the network or a captured page into a new folder, with its PDF when one was found. */
import { makeCiteKey, metadataFields, PDF_FILE, writeNewPaper, type MutationContext } from "../../library/index.js";
import type { PaperRecord } from "../../model/index.js";
import type { ResolvedMetadata } from "../metadata/index.js";
import { NETWORK_IMPORT_MODULE } from "./env.js";

export interface ImportedPaper {
  /** The title is stored as given. */
  metadata: ResolvedMetadata & { title: string };
  pdf?: Uint8Array | undefined;
  /** Fields set on top of the metadata (an identifier the user typed, an abstract URL, the user's tags). */
  extra?: Partial<Pick<PaperRecord, "doi" | "url" | "tags" | "note">>;
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
  const record = await writeNewPaper(ctx, takenIds, targetDir, {
    citeKey: makeCiteKey(metadata, metadata.title),
    fields: { title: metadata.title, ...metadataFields(metadata), ...paper.extra },
    pdf,
    sourceName: paper.sourceName ?? PDF_FILE,
  });
  await ctx.logger.log("INFO", NETWORK_IMPORT_MODULE, paper.log.message, {
    ...paper.log.context, id: record.id, withPdf: Boolean(pdf), targetDir,
  });
  return record;
}
