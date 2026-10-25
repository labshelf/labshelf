/**
 * Reveals a paper wherever it lives: when the open scope holds it, it clears the filters that hide it; otherwise it
 * opens the paper's folder first; then it selects and opens the paper and scrolls it into view.
 */
import { PAPERS_DIR, isUnderDir, deriveParentDir } from "../../../library/index.js";
import { deriveListView } from "../../viewModel/index.js";
import type { UiContext } from "../uiContext.js";

export function showPaper(ctx: UiContext, id: string): void {
  const s = ctx.store.get();
  const paper = s.papers.find((p) => p.id === id);
  if (!paper) return;
  // CONTRACT: documents/contracts/library-ui-host.md#messages
  if (s.folder !== PAPERS_DIR && !isUnderDir(paper.path, s.folder, "/")) ctx.store.openFolder(deriveParentDir(paper.path, "/"));
  else if (!deriveListView(ctx.store.get()).rows.some((p) => p.id === id)) {
    ctx.store.set({ query: "" });
  }
  ctx.store.selectOnly(id);
  ctx.store.openPaper(id);
  [...ctx.root.querySelectorAll<HTMLElement>(".paper-row")].find((r) => r.dataset["id"] === id)?.scrollIntoView({ block: "center" });
}
