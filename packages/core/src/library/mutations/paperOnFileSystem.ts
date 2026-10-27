/** Reads a paper as its folder holds it right now, since another app or a sync may have changed it since the last scan. */
import { type PaperRecord } from "../../model/index.js";
import { METADATA_FILE, PDF_FILE } from "../layout.js";
import { createPaperRecord, isReadingStatus, parsePaperMetadata } from "../record.js";
import type { MutationContext } from "./mutationDeps.js";

/** @returns the paper in `folder`, or undefined when its metadata.yaml is missing or not a mapping */
export async function readPaperOnFileSystem(ctx: MutationContext, folder: string): Promise<PaperRecord | undefined> {
  const meta = await readMetadata(ctx, folder);
  if (!meta) { return undefined; }
  const pdf = await ctx.fs.stat(ctx.paths.join(folder, PDF_FILE));
  return createPaperRecord(meta, { id: ctx.paths.basename(folder), path: folder, hasPdf: pdf?.isFile === true });
}

/** @returns the reading status metadata.yaml holds and when it changed, or undefined when it cannot be read or holds no status */
export async function readReadingStatusOnFileSystem(ctx: MutationContext, folder: string): Promise<Pick<PaperRecord, "status" | "statusChangedAt"> | undefined> {
  const meta = await readMetadata(ctx, folder);
  if (!meta || !isReadingStatus(meta["status"])) { return undefined; }
  const { status, statusChangedAt } = createPaperRecord(meta, { id: "", path: folder, hasPdf: false });
  return statusChangedAt === undefined ? { status } : { status, statusChangedAt };
}

async function readMetadata(ctx: MutationContext, folder: string): Promise<Record<string, unknown> | undefined> {
  const file = ctx.paths.join(folder, METADATA_FILE);
  if (!(await ctx.fs.exists(file))) { return undefined; }
  return parsePaperMetadata(await ctx.fs.readText(file));
}
