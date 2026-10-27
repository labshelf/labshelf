/** Changes the fields the user owns on papers (reading status, tags, note, the day a copy was requested), reading each paper from disk first. */
import type { PaperRecord } from "../../model/index.js";
import { deriveEditedTags, normalizeTags, type ReadingStatus } from "../record.js";
import { formatError } from "../../errors/index.js";
import { MUTATIONS_MODULE, type BatchOutcome, type MutationContext, type Reference } from "./mutationDeps.js";
import { readPaperOnFileSystem } from "./paperOnFileSystem.js";
import { writePaperRecord } from "./paperRecordWrite.js";

export interface PaperFieldsUpdate {
  status?: ReadingStatus;
  tags?: string[];
  note?: string;
  /** The day (YYYY-MM-DD) the user asked the author for a copy; null removes it. */
  pdfRequestedAt?: string | null;
}

export interface FieldsBatchOutcome extends BatchOutcome {
  /** The records written, for the app to put in its index. */
  records: PaperRecord[];
}

/**
 * Applies a patch to the paper in `folder`; an unchanged patch writes nothing.
 * @returns the paper after the patch, or undefined when the folder holds no paper
 */
export async function updatePaperFields(
  ctx: MutationContext,
  folder: string,
  patch: PaperFieldsUpdate,
): Promise<PaperRecord | undefined> {
  const current = await readPaperOnFileSystem(ctx, folder);
  return current && applyPatch(ctx, current, patch);
}

/** @returns the papers changed, with their records, and the failures */
export function setPapersReadingStatus(ctx: MutationContext, papers: Reference[], status: ReadingStatus): Promise<FieldsBatchOutcome> {
  return eachPaper(ctx, papers, (current) => applyPatch(ctx, current, { status }));
}

/**
 * Adds and removes tags on several papers, keeping each paper's other tags as its file holds them.
 * @returns the papers changed, with their records, and the failures
 */
export function updatePaperTags(
  ctx: MutationContext,
  papers: Reference[],
  add: string[],
  remove: string[],
): Promise<FieldsBatchOutcome> {
  return eachPaper(ctx, papers, (current) => applyPatch(ctx, current, { tags: deriveEditedTags(current.tags ?? [], add, remove) }));
}

async function applyPatch(ctx: MutationContext, current: PaperRecord, patch: PaperFieldsUpdate): Promise<PaperRecord> {
  const owned: Pick<PaperRecord, "tags" | "note"> = {};
  if (patch.tags !== undefined) { owned.tags = normalizeTags(patch.tags); }
  if (patch.note !== undefined) { owned.note = patch.note; }
  const requested = patch.pdfRequestedAt === undefined ? {} : { pdfRequestedAt: patch.pdfRequestedAt };
  // CONTRACT: documents/contracts/library-format.md#metadatayaml
  const stamp = patch.status !== undefined && patch.status !== current.status
    ? { status: patch.status, statusChangedAt: ctx.now?.() ?? new Date().toISOString() }
    : {};
  const next: PaperRecord = { ...current, ...stamp, ...owned, ...requested };
  const changed = next.status !== current.status
    || (owned.tags !== undefined && owned.tags.join("\n") !== (current.tags ?? []).join("\n"))
    || (owned.note !== undefined && owned.note !== (current.note ?? ""))
    || (patch.pdfRequestedAt !== undefined && patch.pdfRequestedAt !== (current.pdfRequestedAt ?? null));
  if (!changed) { return current; }
  // `current` was just read from the file, so its status is the file's: writing it back changes nothing.
  const written = await writePaperRecord(ctx, next, { ownsStatus: true, ...owned });
  await ctx.logger.log("INFO", MUTATIONS_MODULE, "Paper updated", { id: current.id, fields: Object.keys(patch) });
  return written;
}

async function eachPaper(
  ctx: MutationContext,
  papers: Reference[],
  run: (current: PaperRecord) => Promise<PaperRecord>,
): Promise<FieldsBatchOutcome> {
  const outcome: FieldsBatchOutcome = { done: [], failed: [], records: [] };
  for (const paper of papers) {
    try {
      const current = await readPaperOnFileSystem(ctx, paper.path);
      if (!current) { throw new Error("Paper not found"); }
      outcome.records.push(await run(current));
      outcome.done.push(paper.id);
    } catch (error) {
      outcome.failed.push({ id: paper.id, error: formatError(error) });
      await ctx.logger.log("WARN", MUTATIONS_MODULE, "Paper update failed", { id: paper.id, message: formatError(error) });
    }
  }
  return outcome;
}
