/**
 * Changes an app makes to papers and folders on disk: resolving ids to folders, moving and trashing paper folders,
 * changing the fields the user owns (reading each paper from disk first) and the descriptions of a paper's files, and
 * creating, renaming, moving and trashing the folders papers are grouped in. Every path in and out is absolute.
 */
import type { PaperRecord } from "../../model/index.js";
import { formatError } from "../../errors/index.js";
import { checkFolderName } from "../folders.js";
import { isUnderDir } from "../folderTree.js";
import { describePaperFile, isHiddenPaperEntry } from "../paperFiles.js";
import { deriveEditedTags, normalizeTags, type ReadingStatus } from "../record.js";
import {
  readPaperOnFileSystem,
  writePaperRecord,
  type BatchOutcome,
  type MutationContext,
  type Reference,
} from "./paperRecordWrite.js";
import { MUTATIONS_MODULE } from "./folderReads.js";

/** What an app's index knows about one paper: its folder, and its record when the index holds one. */
export interface PaperHit {
  path: string;
  record?: PaperRecord;
}

/** A found paper; core mutations accept it as a PaperRef. */
export interface ResolvedReference extends Reference {
  record?: PaperRecord;
}

/**
 * Looks up each id in order; the lookup owns the app's policy, such as rescanning the disk on a miss.
 * @returns the found papers, and a "Paper not found" failure for each id the lookup does not know
 */
export async function resolveReferences(
  ids: readonly string[],
  lookup: (id: string) => Promise<PaperHit | undefined>,
): Promise<{ refs: ResolvedReference[]; failed: BatchOutcome["failed"] }> {
  const refs: ResolvedReference[] = [];
  const failed: BatchOutcome["failed"] = [];
  for (const id of ids) {
    const hit = await lookup(id);
    if (hit) { refs.push({ id, ...hit }); } else { failed.push({ id, error: "Paper not found" }); }
  }
  return { refs, failed };
}

// Paper folders move between folders and go to the trash; sidecars stay, so a restored paper keeps its notes.

export interface PaperMove {
  id: string;
  from: string;
  to: string;
}

export interface MoveOutcome extends BatchOutcome {
  /** Where each moved paper folder went, for the app to re-point its index. */
  moves: PaperMove[];
}

/**
 * Moves paper folders into `targetDir`; papers already there are skipped, name clashes fail.
 * @returns the moves made and the failures
 */
export async function movePapers(ctx: MutationContext, papers: Reference[], targetDir: string): Promise<MoveOutcome> {
  const outcome: MoveOutcome = { done: [], failed: [], moves: [] };
  if ((await ctx.fs.stat(targetDir))?.isDirectory !== true) {
    const error = `The folder "${ctx.paths.basename(targetDir)}" does not exist`;
    await ctx.logger.log("WARN", MUTATIONS_MODULE, "Paper move failed", { targetDir, message: error });
    return { ...outcome, failed: papers.map((paper) => ({ id: paper.id, error })) };
  }
  for (const paper of papers) {
    if (ctx.paths.dirname(paper.path) === targetDir) { continue; }
    const name = ctx.paths.basename(paper.path);
    const destination = ctx.paths.join(targetDir, name);
    try {
      if (await ctx.fs.exists(destination)) { throw new Error(`"${name}" already exists there`); }
      await ctx.fs.rename(paper.path, destination);
      outcome.done.push(paper.id);
      outcome.moves.push({ id: paper.id, from: paper.path, to: destination });
    } catch (error) {
      outcome.failed.push({ id: paper.id, error: formatError(error) });
      await ctx.logger.log("WARN", MUTATIONS_MODULE, "Paper move failed", { id: paper.id, targetDir, message: formatError(error) });
    }
  }
  if (outcome.done.length) {
    await ctx.logger.log("INFO", MUTATIONS_MODULE, "Papers moved", { ids: outcome.done, targetDir });
  }
  return outcome;
}

/**
 * Sends paper folders to the trash, one at a time; a paper that fails stays where it is.
 * @returns the papers trashed and the failures
 */
export async function movePapersToTrash(ctx: MutationContext, papers: Reference[]): Promise<BatchOutcome> {
  const outcome: BatchOutcome = { done: [], failed: [] };
  for (const paper of papers) {
    try {
      await ctx.fs.trash(paper.path);
      outcome.done.push(paper.id);
    } catch (error) {
      outcome.failed.push({ id: paper.id, error: formatError(error) });
      await ctx.logger.log("WARN", MUTATIONS_MODULE, "Paper trash failed", { id: paper.id, message: formatError(error) });
    }
  }
  if (outcome.done.length) {
    await ctx.logger.log("INFO", MUTATIONS_MODULE, "Papers moved to trash", { ids: outcome.done });
  }
  return outcome;
}

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

/**
 * Sets (trimmed) or clears the description of `name`, dropping descriptions of names missing from the folder.
 * @returns the paper as written, or undefined when the folder holds no paper
 * @throws when `name` is not a visible entry of the paper folder
 */
export async function describePaperFileOnFileSystem(
  ctx: MutationContext,
  folder: string,
  name: string,
  description: string,
): Promise<PaperRecord | undefined> {
  const current = await readPaperOnFileSystem(ctx, folder);
  if (!current) { return undefined; }
  const onDisk = (await ctx.fs.listDir(folder)).filter((entry) => !isHiddenPaperEntry(entry));
  const files = isHiddenPaperEntry(name) ? undefined : describePaperFile(current.files, name, description, onDisk);
  if (!files) { throw new Error(`Cannot describe "${name}": it is not a file of the paper in ${folder}`); }
  // CONTRACT: documents/contracts/library-format.md#metadatayaml
  const written = await writePaperRecord(ctx, { ...current, files }, { ownsStatus: true });
  await ctx.logger.log("INFO", "paperFiles", "File description saved", { id: current.id, name, cleared: !description.trim() });
  return written;
}

/** @returns the new folder's path */
export async function createFolder(ctx: MutationContext, parentDir: string, name: string): Promise<string> {
  const trimmed = checkedName(name);
  const dir = ctx.paths.join(parentDir, trimmed);
  if (await ctx.fs.exists(dir)) { throw new Error(`"${trimmed}" already exists`); }
  await ctx.fs.mkdir(dir);
  await ctx.logger.log("INFO", MUTATIONS_MODULE, "Folder created", { dir });
  return dir;
}

/** @returns the folder's path after the rename; the same path when the name does not change */
export async function renameFolder(ctx: MutationContext, dir: string, newName: string): Promise<string> {
  refuseRoot(ctx, dir, "renamed");
  const trimmed = checkedName(newName);
  const to = ctx.paths.join(ctx.paths.dirname(dir), trimmed);
  if (to === dir) { return dir; }
  // On a case-insensitive disk (macOS) "ml" → "ML" finds the folder itself; that rename is allowed.
  const caseOnly = to.toLowerCase() === dir.toLowerCase();
  if (!caseOnly && (await ctx.fs.exists(to))) { throw new Error(`"${trimmed}" already exists there`); }
  await ctx.fs.rename(dir, to);
  await ctx.logger.log("INFO", MUTATIONS_MODULE, "Folder renamed", { from: dir, to });
  return to;
}

/** @returns the folder's path after the move; the same path when it already sits in `targetParentDir` */
export async function moveFolder(ctx: MutationContext, dir: string, targetParentDir: string): Promise<string> {
  refuseRoot(ctx, dir, "moved");
  if (isUnderDir(targetParentDir, dir, ctx.paths.sep)) { throw new Error("A folder cannot be moved into itself."); }
  if (ctx.paths.dirname(dir) === targetParentDir) { return dir; }
  const name = ctx.paths.basename(dir);
  const to = ctx.paths.join(targetParentDir, name);
  if (await ctx.fs.exists(to)) { throw new Error(`"${name}" already exists there`); }
  await ctx.fs.rename(dir, to);
  await ctx.logger.log("INFO", MUTATIONS_MODULE, "Folder moved", { from: dir, to });
  return to;
}

/** Sends a folder and everything in it to the trash; a failure is passed on with nothing deleted by this call. */
export async function moveFolderToTrash(ctx: MutationContext, dir: string): Promise<void> {
  refuseRoot(ctx, dir, "deleted");
  await ctx.fs.trash(dir);
  await ctx.logger.log("INFO", MUTATIONS_MODULE, "Folder moved to trash", { dir });
}

function refuseRoot(ctx: MutationContext, dir: string, verb: string): void {
  if (dir === ctx.papersRoot) { throw new Error(`The library root cannot be ${verb}`); }
}

function checkedName(name: string): string {
  const problem = checkFolderName(name);
  if (problem) { throw new Error(problem); }
  return name.trim();
}
