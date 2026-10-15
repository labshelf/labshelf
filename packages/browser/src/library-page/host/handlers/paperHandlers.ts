/**
 * Does the paper work the UI asks for: set the status, tags and note, move, remove (to the trash) and copy text to the clipboard. Each change
 * goes through the core library mutations, posts a fresh snapshot and asks for a sync soon.
 */
import { PAPERS_DIR, baseName, cleanTags, errorMessage, keptFieldNotice, moveNotice, removeNotice, type PaperStatus } from "@labshelf/core";
import { asRefs, type HostContext } from "../hostContext";
import { scheduleSyncSoon } from "../runtimeRequests";

export async function setStatus(ctx: HostContext, ids: readonly string[], status: PaperStatus): Promise<void> {
  const changed = ctx.papers(ids).filter((p) => p.status !== status);
  if (changed.length === 0) return;
  const { failed } = await ctx.mutations.setStatus(asRefs(changed), status);
  await ctx.snapshots.refresh();
  scheduleSyncSoon(ctx.log, "paper.status");
  if (failed.length) ctx.notice("error", keptFieldNotice("status", failed.length, failed[0]!.error));
}

export async function setTags(ctx: HostContext, ids: readonly string[], add: readonly string[], remove: readonly string[]): Promise<void> {
  const { done, failed } = await ctx.mutations.editTags(asRefs(ctx.papers(ids)), cleanTags(add), cleanTags(remove));
  await ctx.snapshots.refresh();
  if (done.length) scheduleSyncSoon(ctx.log, "paper.tags");
  if (failed.length) ctx.notice("error", keptFieldNotice("tags", failed.length, failed[0]!.error));
}

export async function setNote(ctx: HostContext, id: string, note: string): Promise<void> {
  const [paper] = ctx.papers([id]);
  const written = paper && (await ctx.mutations.setNote({ id: paper.id, path: paper.path }, note));
  if (!written) { ctx.notice("error", "The note could not be saved — the paper is not in the library"); return; }
  await ctx.snapshots.refresh();
  scheduleSyncSoon(ctx.log, "paper.note");
}

/** Moves paper folders under `target`; papers already there are skipped. */
export async function movePapers(ctx: HostContext, ids: readonly string[], target: string): Promise<void> {
  const papers = ctx.papers(ids);
  const { done, failed } = await ctx.mutations.movePapers(asRefs(papers), target);
  if (done.length) { await ctx.snapshots.refresh(); scheduleSyncSoon(ctx.log, "paper.move"); }
  const titleOf = (id: string): string => papers.find((p) => p.id === id)?.title ?? id;
  const notice = moveNotice(done.length, failed, target === PAPERS_DIR ? undefined : baseName(target, "/"), titleOf);
  if (notice) ctx.notice(notice.kind, notice.text);
}

export async function removePapers(ctx: HostContext, ids: readonly string[]): Promise<void> {
  const papers = ctx.papers(ids);
  const { done, failed } = await ctx.mutations.trashPapers(asRefs(papers));
  await ctx.snapshots.refresh();
  if (done.length) scheduleSyncSoon(ctx.log, "paper.delete");
  const notice = removeNotice(done, failed, (id) => papers.find((p) => p.id === id)?.title ?? id);
  if (notice) ctx.notice(notice.kind, notice.text);
}

/** `label` names what was copied ("2 × cite key"); without it the notice quotes the text. */
export async function writeClipboard(ctx: HostContext, text: string, label?: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    ctx.notice("ok", label ? `Copied ${label}` : `Copied: ${text}`);
  } catch (err) {
    ctx.notice("error", `Clipboard blocked — ${errorMessage(err)}`);
  }
}
