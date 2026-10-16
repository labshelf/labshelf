/**
 * Applies what the host sends: snapshots, navigation, selection, per-paper data, OCR jobs and the citation map go to the store, notices
 * and progress become toasts, and PDF and add-paper replies open their dialogs.
 */
import { toast } from "../../ui/dom/index.js";
import type { HostToUi } from "../protocol/index.js";
import { onAddNoPdf, onAddSources, onFindMiss, onPdfMissing, revealPaper } from "./flows/index.js";
import type { UiContext } from "./uiContext.js";

function applyData(ctx: UiContext, m: HostToUi): boolean {
  switch (m.type) {
    case "snapshot":
      ctx.store.applySnapshot(m.snapshot);
      // A record may have changed under the paper on show (its PDF, its file size); ask again for what it shows.
      ctx.data.invalidate(null);
      return true;
    case "details": ctx.data.received(m.id); ctx.store.setDetails(m.id, m.details); return true;
    case "similar": ctx.store.setSimilar(m.id, m.items); return true;
    case "sidecarChanged": ctx.data.invalidate(m.id); return true;
    case "jobs": ctx.store.setJobs(m.jobs); return true;
    case "citationMap.show": ctx.store.showCitationMap(m.state); return true;
    case "citationMap.imported": ctx.store.removeMissingWork(m.workId); return true;
    case "citationMap.importFailed": ctx.store.setCitationImporting(m.workId, false); return true;
    default: return false;
  }
}

/** Starts handling host messages; returns the function that stops it. */
export function attachHostMessages(ctx: UiContext): () => void {
  // One toast per progress key, replaced or dismissed by the next message with that key.
  const progress = new Map<string, () => void>();
  const showProgress = (key: string, text: string | null): void => {
    progress.get(key)?.();
    progress.delete(key);
    if (text) progress.set(key, toast(text, "info"));
  };
  return ctx.transport.subscribe((m: HostToUi) => {
    if (applyData(ctx, m)) return;
    switch (m.type) {
      case "navigate": ctx.store.openFolder(m.folder); return;
      case "reveal": revealPaper(ctx, m.id); return;
      case "select": ctx.store.selectOnly(m.id); return;
      case "notice": toast(m.text, m.kind); return;
      case "progress": showProgress(m.key, m.text); return;
      case "pdf.busy": ctx.store.setPdfBusy(m.id, m.busy); return;
      case "pdf.missing": void onPdfMissing(ctx, m.id); return;
      case "pdf.findResult": void onFindMiss(ctx, m.id, m.miss); return;
      case "add.sources": void onAddSources(ctx, m.folder, m.sources); return;
      case "add.noPdf": void onAddNoPdf(ctx, m.folder, m.sourceId, m.title, m.miss); return;
    }
  });
}
