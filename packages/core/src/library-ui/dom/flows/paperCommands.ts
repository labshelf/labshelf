/**
 * The paper actions that need no dialog: open, set the status, copy cite keys, find or attach a PDF. Each one asks
 * the host; a status change also shows at once, before the host's snapshot confirms it.
 */
import type { PaperStatus } from "../../../model/index.js";
import type { UiContext } from "../uiContext.js";

export function openPaper(ctx: UiContext, id: string): void {
  ctx.transport.post({ type: "paper.open", id });
}

export function setPaperStatus(ctx: UiContext, ids: readonly string[], status: PaperStatus): void {
  const byId = new Map(ctx.store.get().papers.map((p) => [p.id, p]));
  const changed = ids.filter((id) => byId.has(id) && byId.get(id)!.status !== status);
  if (changed.length === 0) return;
  ctx.store.applyStatus(changed, status);
  ctx.transport.post({ type: "paper.setStatus", ids: changed, status });
}

/** Copies the cite keys of the given papers, comma-joined, in list order. */
export function copyCiteKeys(ctx: UiContext, ids: readonly string[]): void {
  const wanted = new Set(ids);
  const keys = ctx.store.get().papers.filter((p) => wanted.has(p.id)).map((p) => p.citeKey);
  if (keys.length) ctx.transport.post({ type: "clipboard.write", text: keys.join(",") });
}

/** Starts a PDF search unless one is already running for this paper. */
export function findPdf(ctx: UiContext, id: string): void {
  if (ctx.store.get().pdfBusy.has(id)) return;
  ctx.transport.post({ type: "paper.findPdf", id });
}

/** Must run inside the click that asked for it: the host opens a file picker, which browsers allow only in a gesture. */
export function attachPdf(ctx: UiContext, id: string): void {
  ctx.transport.post({ type: "paper.attachPdf", id });
}
