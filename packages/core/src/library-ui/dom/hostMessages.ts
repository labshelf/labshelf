/**
 * Applies what the host sends: snapshots, navigation and selection go to the store, notices and progress become
 * toasts, and PDF and add-paper replies open their dialogs.
 */
import { toast } from "../../ui/dom/index.js";
import type { HostToUi } from "../protocol/index.js";
import { onAddNoPdf, onAddSources, onFindMiss, onPdfMissing } from "./flows/index.js";
import type { UiContext } from "./uiContext.js";

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
    switch (m.type) {
      case "snapshot": ctx.store.applySnapshot(m.snapshot); return;
      case "navigate": ctx.store.openFolder(m.folder); return;
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
