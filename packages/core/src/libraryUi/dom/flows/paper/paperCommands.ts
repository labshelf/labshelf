/**
 * Runs the paper actions that need no dialog. Each asks the host; status, tag and note changes and queued OCR also
 * show at once, before the host confirms them.
 */
import type { PaperStatus } from "../../../../model/index.js";
import { hasNoText, listPapersUnder } from "../../../viewModel/index.js";
import { PAPERS_DIR } from "../../../../library/index.js";
import type { UiContext } from "../../uiContext.js";

export function openPaper(ctx: UiContext, id: string, page?: number): void {
  ctx.transport.post(page ? { type: "paper.open", id, page } : { type: "paper.open", id });
}

/** Opens a writing project's source at a zero-based line. */
export function openSource(ctx: UiContext, project: string, file: string, line: number): void {
  ctx.transport.post({ type: "project.openSource", project, file, line });
}

export function setPaperStatus(ctx: UiContext, ids: readonly string[], status: PaperStatus): void {
  const byId = new Map(ctx.store.get().papers.map((p) => [p.id, p]));
  const changed = ids.filter((id) => byId.has(id) && byId.get(id)!.status !== status);
  if (changed.length === 0) return;
  ctx.store.applyStatus(changed, status);
  ctx.transport.post({ type: "paper.setStatus", ids: changed, status });
}

/** The tags in comma-separated `text`, trimmed, empty ones dropped. */
export function splitTags(text: string): string[] {
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}

export function changeTags(ctx: UiContext, ids: readonly string[], add: string[], remove: string[]): void {
  if (ids.length === 0 || (add.length === 0 && remove.length === 0)) return;
  ctx.store.applyTags(ids, add, remove);
  ctx.transport.post({ type: "paper.setTags", ids: [...ids], add, remove });
}

export function saveNote(ctx: UiContext, id: string, note: string): void {
  ctx.store.applyNote(id, note);
  ctx.transport.post({ type: "paper.setNote", id, note });
}

/** The papers among `ids` that OCR could fix and that are not queued yet. */
export function fixableIds(ctx: UiContext, ids: readonly string[]): string[] {
  const s = ctx.store.get();
  const wanted = new Set(ids);
  return listPapersUnder(s.papers, PAPERS_DIR, s.pdfDirs).filter((p) => wanted.has(p.id) && hasNoText(p) && !s.jobs[p.id]).map((p) => p.id);
}

export function makeSearchable(ctx: UiContext, ids: readonly string[]): void {
  if (ids.length === 0) return;
  ctx.store.queueJobs(ids);
  ctx.transport.post({ type: "paper.makeSearchable", ids: [...ids] });
}

/** Starts a PDF search unless one is already running for this paper; `replace` looks for a better version of its PDF. */
export function findPdf(ctx: UiContext, id: string, replace = false): void {
  if (ctx.store.get().pdfBusy.has(id)) return;
  ctx.transport.post(replace ? { type: "paper.findPdf", id, replace } : { type: "paper.findPdf", id });
}

/** The host finds an author address, opens the request email and records the day it was sent. */
export function askAuthor(ctx: UiContext, id: string): void {
  ctx.transport.post({ type: "paper.askAuthor", id });
}

/** Must run inside the click that asked for it: the host opens a file picker, which browsers allow only in a gesture. */
export function attachPdf(ctx: UiContext, id: string): void {
  ctx.transport.post({ type: "paper.attachPdf", id });
}

type FileAction = "paper.openExternal" | "paper.reveal" | "paper.fetchMetadata" | "annotations.export";

/** Asks the host for one of its file actions on a paper. */
export function hostFileAction(ctx: UiContext, type: FileAction, id: string): void {
  ctx.transport.post({ type, id });
}
