/**
 * Asks once before papers are removed, then hands the removal to the host, which moves their folders to the trash.
 */
import { showDialog } from "../../../ui/dom/index.js";
import type { UiContext } from "../uiContext.js";

export async function askRemove(ctx: UiContext, ids: readonly string[]): Promise<void> {
  const wanted = new Set(ids);
  const papers = ctx.store.get().papers.filter((p) => wanted.has(p.id));
  if (papers.length === 0) return;
  const one = papers.length === 1;
  const choice = await showDialog({
    title: one ? `Remove "${papers[0]!.title}" from the library?` : `Remove ${papers.length} papers from the library?`,
    message: one
      ? "Its folder and files are deleted from the library on this device and on every synced device."
      : "Their folders and files are deleted from the library on this device and on every synced device.",
    severity: "danger",
    buttons: [{ id: "remove", label: "Remove", primary: true, danger: true }],
  });
  if (choice !== "remove") return;
  ctx.store.clearSelection();
  ctx.transport.post({ type: "paper.remove", ids: papers.map((p) => p.id) });
}
