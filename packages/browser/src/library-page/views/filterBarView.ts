/**
 * Filter bar under the header: reading-status tabs (All / Unread / Reading /
 * Done, each with its count in the current scope) and the subfolder chip
 * strip. Folders never take list rows — the chips are the only place the
 * folder structure shows inside the list pane. Chips are drop targets.
 */
import { el } from "@labshelf/core/dom";
import { escapeHtml, parseQuery, subfoldersOf, icon } from "@labshelf/core";
import { ROOT, STATUSES, STATUS_LABEL, listPapersUnder, papersInScope, statusCounts } from "../state/derive";
import type { LibraryStore, StatusFilter } from "../state/libraryStore";
import { makeDropTarget } from "./dnd";

/** Mounts the filter bar and returns an unsubscribe function. */
export function mountFilterBar(container: HTMLElement, store: LibraryStore): () => void {
  container.innerHTML = `
    <div class="status-filters" id="statusFilters" role="tablist" aria-label="Reading status"></div>
    <div class="sub-strip" id="subStrip" aria-label="Subfolders"></div>
  `;
  const tabs = container.querySelector<HTMLElement>("#statusFilters")!;
  const strip = container.querySelector<HTMLElement>("#subStrip")!;

  return store.select(
    (s) => ({ folder: s.folder, folders: s.folders, papers: s.papers, query: s.query, status: s.status, includeSub: s.includeSub, pdfDirs: s.pdfDirs }),
    (slice) => {
      const inFolder = listPapersUnder(slice.papers, slice.folder, slice.pdfDirs);
      const counts = statusCounts(papersInScope(inFolder, parseQuery(slice.query), slice.includeSub));
      renderTabs(tabs, store, slice.status, counts);
      renderChips(strip, store, subfoldersOf(slice.folders, slice.folder, ROOT, slice.papers.map((p) => p.path)));
    },
  );
}

function renderTabs(container: HTMLElement, store: LibraryStore, active: StatusFilter, counts: Record<StatusFilter, number>): void {
  const frag = document.createDocumentFragment();
  for (const key of ["all", ...STATUSES] as StatusFilter[]) {
    const b = el("button", {
      class: `status-tab${active === key ? " active" : ""}`,
      type: "button",
      role: "tab",
      "aria-selected": String(active === key),
      html: `${key === "all" ? "" : `<span class="ls-dot s-${key}"></span>`}<span>${key === "all" ? "All" : STATUS_LABEL[key]}</span><span class="n">${counts[key]}</span>`,
    });
    b.addEventListener("click", () => store.set({ status: key }));
    frag.append(b);
  }
  container.replaceChildren(frag);
}

function renderChips(container: HTMLElement, store: LibraryStore, subfolders: Array<{ label: string; path: string; count: number }>): void {
  const frag = document.createDocumentFragment();
  for (const f of subfolders) {
    const b = el("button", {
      class: "ls-chip",
      type: "button",
      title: `Open ${f.label} — or drop papers here to move them`,
      html: `${icon("folder")}<span>${escapeHtml(f.label)}</span>${f.count > 0 ? `<span class="n">${f.count}</span>` : ""}`,
    });
    b.addEventListener("click", () => store.openFolder(f.path));
    makeDropTarget(b, f.path);
    frag.append(b);
  }
  container.replaceChildren(frag);
}
