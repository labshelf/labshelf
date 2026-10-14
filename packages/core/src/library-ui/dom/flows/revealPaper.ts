/**
 * Shows a paper wherever it lives: in the open folder it clears the filters that hide it, elsewhere it opens the
 * paper's folder first; then it selects the paper and scrolls it into view.
 */
import { PAPERS_DIR, isUnderDir, parentDir } from "../../../library/index.js";
import { deriveListView } from "../../derive/index.js";
import type { UiContext } from "../uiContext.js";

export function revealPaper(ctx: UiContext, id: string): void {
  const s = ctx.store.get();
  const paper = s.papers.find((p) => p.id === id);
  if (!paper) return;
  const folder = parentDir(paper.path, "/");
  if (s.folder !== PAPERS_DIR && !isUnderDir(paper.path, s.folder, "/")) ctx.store.openFolder(folder);
  else if (!deriveListView(ctx.store.get()).rows.some((p) => p.id === id)) {
    ctx.store.set({ status: "all", noText: false, query: "", ...(folder !== s.folder ? { includeSub: true } : {}) });
  }
  ctx.store.selectOnly(id);
  [...ctx.root.querySelectorAll<HTMLElement>(".paper-row")].find((r) => r.dataset["id"] === id)?.scrollIntoView({ block: "center" });
}
