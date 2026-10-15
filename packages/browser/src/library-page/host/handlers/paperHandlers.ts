/**
 * Does the paper work the UI asks for: set the status, tags and note, move, remove (to the trash) and copy text to the clipboard. Each change
 * goes through the core library mutations, posts a fresh snapshot and asks for a sync soon.
 */
import { PAPERS_DIR, ROOT_LABEL, baseName, type PaperStatus } from "@labshelf/core";
import { asRefs, type HostContext } from "../hostContext";
import { errorMessage, scheduleSyncSoon } from "../runtimeRequests";

export async function setStatus(ctx: HostContext, ids: readonly string[], status: PaperStatus): Promise<void> {
  const changed = ctx.papers(ids).filter((p) => p.status !== status);
  if (changed.length === 0) return;
  const { failed } = await ctx.mutations.setStatus(asRefs(changed), status);
  await ctx.snapshots.refresh();
  scheduleSyncSoon("paper.status");
  if (failed.length) ctx.notice("error", `${failed.length} could not be updated — ${failed[0]!.error}`);
}

export async function setTags(ctx: HostContext, ids: readonly string[], add: readonly string[], remove: readonly string[]): Promise<void> {
  const clean = (tags: readonly string[]): string[] => tags.map((t) => t.trim()).filter(Boolean);
  const { done, failed } = await ctx.mutations.editTags(asRefs(ctx.papers(ids)), clean(add), clean(remove));
  await ctx.snapshots.refresh();
  if (done.length) scheduleSyncSoon("paper.tags");
  if (failed.length) ctx.notice("error", `${failed.length} kept their tags — ${failed[0]!.error}`);
}

export async function setNote(ctx: HostContext, id: string, note: string): Promise<void> {
  const [paper] = ctx.papers([id]);
  const written = paper && (await ctx.mutations.setNote({ id: paper.id, path: paper.path }, note));
  if (!written) { ctx.notice("error", "The note could not be saved — the paper is not in the library"); return; }
  await ctx.snapshots.refresh();
  scheduleSyncSoon("paper.note");
}

/** Moves paper folders under `target`; papers already there are skipped. */
export async function movePapers(ctx: HostContext, ids: readonly string[], target: string): Promise<void> {
  const papers = ctx.papers(ids);
  const { done, failed } = await ctx.mutations.movePapers(asRefs(papers), target);
  if (done.length) { await ctx.snapshots.refresh(); scheduleSyncSoon("paper.move"); }
  const where = target === PAPERS_DIR ? ROOT_LABEL : baseName(target, "/");
  const first = failed[0];
  const titleOf = (id: string): string => papers.find((p) => p.id === id)?.title ?? id;
  if (first) ctx.notice("error", `${done.length} moved, ${failed.length} failed — "${titleOf(first.id)}" — ${first.error}`);
  else if (done.length) ctx.notice("ok", `${done.length} paper${done.length === 1 ? "" : "s"} moved to ${where}`);
}

export async function removePapers(ctx: HostContext, ids: readonly string[]): Promise<void> {
  const { done, failed } = await ctx.mutations.trashPapers(asRefs(ctx.papers(ids)));
  await ctx.snapshots.refresh();
  if (done.length) scheduleSyncSoon("paper.delete");
  if (failed.length) ctx.notice("error", `${done.length} removed, ${failed.length} failed — ${failed[0]!.error}`);
  else ctx.notice("ok", done.length === 1 ? "Paper removed" : `${done.length} papers removed`);
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
