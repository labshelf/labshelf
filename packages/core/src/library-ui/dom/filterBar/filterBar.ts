/**
 * The filter bar under the header: the reading-status tabs, each with its count in the current scope, and the strip
 * of subfolder chips. Folders never take list rows; the chips open them and accept dropped papers.
 */
import { PAPERS_DIR, subfoldersOf } from "../../../library/index.js";
import { PAPER_STATUSES, STATUS_LABEL } from "../../../model/index.js";
import { el } from "../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";
import { deriveScope } from "../../derive/index.js";
import type { StatusFilter } from "../../state/index.js";
import { makeDropTarget } from "../dnd/index.js";
import type { UiContext } from "../uiContext.js";

function renderTabs(ctx: UiContext, container: HTMLElement, active: StatusFilter, counts: Record<StatusFilter, number>): void {
  const frag = document.createDocumentFragment();
  for (const key of ["all", ...PAPER_STATUSES] as StatusFilter[]) {
    const b = el("button", {
      class: `status-tab${active === key ? " active" : ""}`,
      type: "button",
      role: "tab",
      "aria-selected": String(active === key),
      html: `${key === "all" ? "" : `<span class="ls-dot s-${key}"></span>`}<span>${key === "all" ? "All" : STATUS_LABEL[key]}</span><span class="n">${counts[key]}</span>`,
    });
    b.addEventListener("click", () => ctx.store.set({ status: key }));
    frag.append(b);
  }
  container.replaceChildren(frag);
}

function renderChips(ctx: UiContext, container: HTMLElement, subfolders: Array<{ label: string; path: string; count: number }>): void {
  const frag = document.createDocumentFragment();
  for (const f of subfolders) {
    const b = el("button", {
      class: "ls-chip",
      type: "button",
      title: `Open ${f.label} — or drop papers here to move them`,
      html: `${icon("folder")}<span>${escapeHtml(f.label)}</span>${f.count > 0 ? `<span class="n">${f.count}</span>` : ""}`,
    });
    b.addEventListener("click", () => ctx.store.openFolder(f.path));
    makeDropTarget(ctx, b, f.path);
    frag.append(b);
  }
  container.replaceChildren(frag);
}

/** Mounts the filter bar and returns its unsubscribe function. */
export function mountFilterBar(ctx: UiContext, container: HTMLElement): () => void {
  const tabs = el("div", { class: "status-filters", role: "tablist", "aria-label": "Reading status" });
  const strip = el("div", { class: "sub-strip", "aria-label": "Subfolders" });
  container.replaceChildren(tabs, strip);
  return ctx.store.select(
    (s) => ({ folder: s.folder, folders: s.folders, papers: s.papers, query: s.query, status: s.status, includeSub: s.includeSub, pdfDirs: s.pdfDirs }),
    (slice) => {
      const { counts } = deriveScope(slice);
      renderTabs(ctx, tabs, slice.status, counts);
      renderChips(ctx, strip, subfoldersOf(slice.folders, slice.folder, PAPERS_DIR, slice.papers.map((p) => p.path)));
    },
  );
}
