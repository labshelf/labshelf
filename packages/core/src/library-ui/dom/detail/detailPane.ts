/**
 * The detail pane: the selected paper (or a multi-selection summary), with its buttons routed to paper commands and
 * flows. Folded sections are saved in the prefs.
 */
import { PAPERS_DIR } from "../../../library/index.js";
import type { PaperStatus } from "../../../model/index.js";
import { listPapersUnder } from "../../derive/index.js";
import { attachPdf, confirmRemove, copyCiteKeys, findPdf, openPaper, pickMoveTarget, setPaperStatus } from "../flows/index.js";
import type { UiContext } from "../uiContext.js";
import { multiDetailHtml, paperDetailHtml } from "./detailSections.js";

interface Pane {
  ctx: UiContext;
  el: HTMLElement;
  collapsed: Record<string, boolean>;
  abstractOpen: boolean;
  lastKey: string;
}

function render(pane: Pane): void {
  const s = pane.ctx.store.get();
  const ids = [...s.selected];
  if (ids.length === 0) { pane.el.innerHTML = `<div class="detail-placeholder">Select a paper to see details</div>`; return; }
  if (ids.length > 1) { pane.el.innerHTML = multiDetailHtml(ids.length); return; }
  const paper = listPapersUnder(s.papers, PAPERS_DIR, s.pdfDirs).find((p) => p.id === ids[0]);
  if (!paper) { pane.el.innerHTML = ""; return; }
  const scroll = pane.el.scrollTop;
  pane.el.innerHTML = paperDetailHtml(paper, { collapsed: pane.collapsed, abstractOpen: pane.abstractOpen, openFolder: s.folder, pdfBusy: s.pdfBusy.has(paper.id) });
  pane.el.scrollTop = scroll;
}

function toggleSection(pane: Pane, head: HTMLElement): void {
  const sec = head.dataset["sec"]!;
  const closed = !pane.collapsed[sec];
  pane.collapsed = { ...pane.collapsed, [sec]: closed };
  pane.ctx.prefs.save({ secCollapsed: pane.collapsed });
  head.classList.toggle("collapsed", closed);
  head.setAttribute("aria-expanded", String(!closed));
  head.querySelector(".sec-chevron")?.classList.toggle("collapsed", closed);
  pane.el.querySelector(`[data-sec-body="${sec}"]`)?.classList.toggle("hidden", closed);
}

function runAction(pane: Pane, action: string | undefined, target: HTMLElement): void {
  const { ctx } = pane;
  const ids = [...ctx.store.get().selected];
  const id = ids[0]!;
  switch (action) {
    case "setStatus": setPaperStatus(ctx, ids, target.dataset["status"] as PaperStatus); return;
    case "goFolder": {
      const paper = ctx.store.get().papers.find((p) => p.id === id);
      if (paper) ctx.store.openFolder(paper.path.slice(0, paper.path.lastIndexOf("/")));
      return;
    }
    case "toggleAbstract": pane.abstractOpen = !pane.abstractOpen; render(pane); return;
    case "searchKeyword": ctx.store.set({ status: "all", query: (target.dataset["keyword"] ?? "").toLowerCase() }); ctx.focusSearch(); return;
    case "move": void pickMoveTarget(ctx, ids); return;
    case "open-pdf": openPaper(ctx, id); return;
    case "copy-cite": copyCiteKeys(ctx, [id]); return;
    case "delete": void confirmRemove(ctx, [id]); return;
    case "find-pdf": findPdf(ctx, id); return;
    case "attach-pdf": attachPdf(ctx, id); return;
  }
}

/** Mounts the detail pane and returns its unsubscribe function. */
export function mountDetailPane(ctx: UiContext, container: HTMLElement): () => void {
  const pane: Pane = { ctx, el: container, collapsed: ctx.prefs.load().secCollapsed, abstractOpen: false, lastKey: "" };
  container.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const head = target.closest<HTMLElement>(".sec-head");
    if (head) { toggleSection(pane, head); return; }
    const el = target.closest<HTMLElement>("[data-action]");
    if (!el || ctx.store.get().selected.size === 0) return;
    e.preventDefault();
    runAction(pane, el.dataset["action"], el);
  });
  return ctx.store.select(
    (s) => ({ selected: s.selected, papers: s.papers, folder: s.folder, pdfDirs: s.pdfDirs, pdfBusy: s.pdfBusy }),
    ({ selected }) => {
      // A new selection starts with the abstract folded again.
      const key = [...selected].sort().join("|");
      if (key !== pane.lastKey) { pane.abstractOpen = false; pane.lastKey = key; }
      render(pane);
    },
  );
}
