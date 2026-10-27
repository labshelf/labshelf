/** Writes a new paper folder: claims a free cite key, saves the PDF when there is one and writes the metadata files. */
import type { PaperRecord } from "../../../model/index.js";
import { ensureCiteKey } from "../../citeKey.js";
import type { MutationContext } from "../mutationDeps.js";
import { PDF_FILE } from "../../layout.js";

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
