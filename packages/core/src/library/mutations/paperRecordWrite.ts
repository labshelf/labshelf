/**
 * Writes a paper record to metadata.yaml and bib.bib under the ownership rules of the library-format and sync contracts:
 * tags, note and the reading status belong to whoever set them, and hasPdf is never stored.
 */
import type { PaperRecord } from "../../model/index.js";
import { PDF_FILE } from "../layout.js";
import { formatError } from "../../errors/index.js";
import { MUTATIONS_MODULE, type MutationContext } from "./mutationDeps.js";
import { readReadingStatusOnFileSystem } from "./paperOnFileSystem.js";

export interface WriteRecordOptions {
  /** True only for an explicit status change; any other rewrite keeps the status metadata.yaml holds. */
  ownsStatus: boolean;
  /** Set to replace the file's tags; left out, the file's own tags stay. */
  tags?: string[];
  /** Set to replace the file's note; left out, the file's own note stays. */
  note?: string;
}

/**
 * Rewrites a paper's metadata.yaml and bib.bib from a record, typically one from an app's index.
 * @returns the record as written, with the status that went to disk
 */
export async function writePaperRecord(
  ctx: MutationContext,
  record: PaperRecord,
  options: WriteRecordOptions,
): Promise<PaperRecord> {
  // The status and its timestamp go together: when the file's status wins, so does the file's timestamp.
  const { statusChangedAt: _changedAt, ...unstamped } = record;
  const { tags: _tags, note: _note, hasPdf: _hasPdf, ...rest } = unstamped;
  const status = options.ownsStatus ? statusFields(record) : await keptStatus(ctx, record);
  const owned: Pick<PaperRecord, "tags" | "note"> = {};
  if (options.tags !== undefined) { owned.tags = options.tags; }
  if (options.note !== undefined) { owned.note = options.note; }
  await ctx.artifacts.writePaperArtifacts(record.path, { ...rest, ...status, ...owned }, ctx.paths.join(record.path, PDF_FILE));
  return { ...unstamped, ...status, ...owned };
}

type StatusFields = Pick<PaperRecord, "status" | "statusChangedAt">;

function statusFields(record: PaperRecord): StatusFields {
  return record.statusChangedAt === undefined ? { status: record.status } : { status: record.status, statusChangedAt: record.statusChangedAt };
}

// The terminal app or a sync may have changed the status after the index was built; the file's copy wins.
async function keptStatus(ctx: MutationContext, record: PaperRecord): Promise<StatusFields> {
  let reason: string;
  try {
    const onDisk = await readReadingStatusOnFileSystem(ctx, record.path);
    if (onDisk) { return onDisk; }
    reason = "metadata.yaml holds no valid status";
  } catch (error) {
    reason = formatError(error);
  }
  await ctx.logger.log("WARN", MUTATIONS_MODULE, "Status on disk unreadable, keeping the indexed status", {
    id: record.id, status: record.status, reason,
  });
  return statusFields(record);
}
