/**
 * Does the paper work the UI asks for: set the status, tags and note, move, remove (to the trash) and copy text to the clipboard. Each change
 * goes through the core library mutations and posts a fresh snapshot.
 */
import { PAPERS_DIR, deriveBaseName, deriveCleanTags, formatError, formatKeptFieldNotice, moveNotice, removeNotice, titleResolver, type ReadingStatus } from "@labshelf/core";
import { deriveReferences, type HostContext } from "../hostContext";

export async function setReadingStatus(ctx: HostContext, ids: readonly string[], status: ReadingStatus): Promise<void> {
  const changed = ctx.papers(ids).filter((p) => p.status !== status);
  if (changed.length === 0) return;
  const { failed } = await ctx.mutations.setStatus(deriveReferences(changed), status);
  await ctx.snapshots.refresh();
  if (failed.length) ctx.notice("error", formatKeptFieldNotice("status", failed.length, failed[0]!.error));
}

export async function setTags(ctx: HostContext, ids: readonly string[], add: readonly string[], remove: readonly string[]): Promise<void> {
  const { failed } = await ctx.mutations.editTags(deriveReferences(ctx.papers(ids)), deriveCleanTags(add), deriveCleanTags(remove));
  await ctx.snapshots.refresh();
  if (failed.length) ctx.notice("error", formatKeptFieldNotice("tags", failed.length, failed[0]!.error));
}

export async function setNote(ctx: HostContext, id: string, note: string): Promise<void> {
  const [paper] = ctx.papers([id]);
  const written = paper && (await ctx.mutations.setNote({ id: paper.id, path: paper.path }, note));
  if (!written) { ctx.notice("error", "The note could not be saved — the paper is not in the library"); return; }
  await ctx.snapshots.refresh();
}

/** Moves paper folders under `target`; papers already there are skipped. */
export async function movePapers(ctx: HostContext, ids: readonly string[], target: string): Promise<void> {
  const papers = ctx.papers(ids);
  const { done, failed } = await ctx.mutations.movePapers(deriveReferences(papers), target);
  if (done.length) await ctx.snapshots.refresh();
  const notice = moveNotice(done.length, failed, target === PAPERS_DIR ? undefined : deriveBaseName(target, "/"), titleResolver(papers));
  if (notice) ctx.notice(notice.kind, notice.text);
}

export async function removePapers(ctx: HostContext, ids: readonly string[]): Promise<void> {
  const papers = ctx.papers(ids);
  const { done, failed } = await ctx.mutations.trashPapers(deriveReferences(papers));
  await ctx.snapshots.refresh();
  const notice = removeNotice(done, failed, titleResolver(papers));
  if (notice) ctx.notice(notice.kind, notice.text);
}

/** `label` names what was copied ("2 × cite key"); without it the notice quotes the text. */
export async function writeClipboard(ctx: HostContext, text: string, label?: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    ctx.notice("ok", label ? `Copied ${label}` : `Copied: ${text}`);
  } catch (err) {
    ctx.notice("error", `Clipboard blocked — ${formatError(err)}`);
  }
}
