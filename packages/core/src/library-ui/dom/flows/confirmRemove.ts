/**
 * Asks once before papers are removed, then hands the removal to the host. The wording never claims a PDF is deleted
 * when none of the papers has one.
 */
import { showDialog } from "../../../ui/dom/index.js";
import type { UiContext } from "../uiContext.js";

export async function confirmRemove(ctx: UiContext, ids: readonly string[]): Promise<void> {
  const s = ctx.store.get();
  const wanted = new Set(ids);
  const papers = s.papers.filter((p) => wanted.has(p.id));
  if (papers.length === 0) return;
  const title = papers.length === 1 ? `Remove "${papers[0]!.title}" from the library?` : `Remove ${papers.length} papers from the library?`;
  const message = papers.some((p) => s.pdfDirs.has(p.path))
    ? "The PDF and its metadata are deleted from this browser. The next sync removes them from Google Drive and from the VS Code extension."
    : "The metadata is deleted from this browser. The next sync removes it from Google Drive and from the VS Code extension.";
  const choice = await showDialog({ title, message, severity: "danger", buttons: [{ id: "remove", label: "Remove", primary: true, danger: true }] });
  if (choice !== "remove") return;
  ctx.store.clearSelection();
  ctx.transport.post({ type: "paper.remove", ids: papers.map((p) => p.id) });
}
