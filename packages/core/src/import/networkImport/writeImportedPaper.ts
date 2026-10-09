/** Writes a paper that came from the network: claims its cite key, creates the folder, saves the PDF if any, writes the artifacts. */
import { claimCiteKey, makeCiteKey, metadataFields, PDF_FILE, type ImportDeps, type MutationContext } from "../../library/index.js";
import type { PaperRecord } from "../../model/index.js";
import type { ResolvedMetadata } from "../metadata/index.js";
import { normalizeTitle } from "../pdf/index.js";
import { NETWORK_IMPORT_MODULE } from "./env.js";

export interface ImportedPaper {
  /** Needs a title. */
  metadata: ResolvedMetadata;
  pdf?: Uint8Array | undefined;
  /** Fields set on top of the metadata (an identifier the user typed, an abstract URL). */
  extra?: Partial<PaperRecord>;
  /** The file name the sidecar records as the paper's source. */
  sourceName?: string;
  /** What the log line says, and the context that identifies the import. */
  log: { message: string; context: Record<string, unknown> };
}

/** @returns the stored record */
export async function writeImportedPaper(
  ctx: MutationContext,
  deps: ImportDeps,
  targetDir: string,
  paper: ImportedPaper,
): Promise<PaperRecord> {
  const { metadata, pdf } = paper;
  const title = normalizeTitle(metadata.title!);
  const id = await claimCiteKey(
    makeCiteKey({ ...metadata, title }, title),
    deps.takenIds(),
    (key) => ctx.fs.exists(ctx.paths.join(targetDir, key)),
  );
  const folder = ctx.paths.join(targetDir, id);
  await ctx.fs.mkdir(folder);
  if (pdf) { await ctx.fs.writeFile(ctx.paths.join(folder, PDF_FILE), pdf); }
  const record: PaperRecord = {
    id, title, path: folder, citeKey: id, status: "unread", hasPdf: Boolean(pdf),
    ...metadataFields(metadata),
    ...paper.extra,
  };
  const { hasPdf: _hasPdf, ...stored } = record;
  await ctx.artifacts.writePaperArtifacts(folder, stored, paper.sourceName ?? PDF_FILE);
  await ctx.logger.log("INFO", NETWORK_IMPORT_MODULE, paper.log.message, { ...paper.log.context, id, withPdf: Boolean(pdf), targetDir });
  return record;
}
