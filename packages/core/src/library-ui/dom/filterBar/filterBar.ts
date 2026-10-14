/**
 * The filter bar: the status tabs with their counts, the No text filter when the host knows text layers, and the
 * subfolder chips, which open their folder and accept dropped papers.
 */
import { PAPERS_DIR, subfoldersOf } from "../../../library/index.js";
import { PAPER_STATUSES, STATUS_LABEL } from "../../../model/index.js";
import { el } from "../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";
import { deriveScope, type ListScope } from "../../derive/index.js";
import type { StatusFilter } from "../../state/index.js";
import { makeDropTarget } from "../dnd/index.js";
import { KEY_HINT, type UiContext } from "../uiContext.js";

function statusTab(ctx: UiContext, key: StatusFilter, i: number, active: boolean, count: number): HTMLElement {
  const b = el("button", {
    class: `status-tab${active ? " active" : ""}`,
    type: "button",
    role: "tab",
    "aria-selected": String(active),
    title: key === "all" ? undefined : `Show ${STATUS_LABEL[key].toLowerCase()} papers. Mark the selection with ${KEY_HINT.alt}${i}`,
    html: `${key === "all" ? "" : `<span class="ls-dot s-${key}"></span>`}<span>${key === "all" ? "All" : STATUS_LABEL[key]}</span><span class="n">${count}</span>`,
  });
  b.addEventListener("click", () => ctx.store.set({ status: key }));
  return b;
}

// Shown only while some paper in scope lacks text (or the filter is on), so libraries without scans never see it.
function noTextTab(ctx: UiContext, active: boolean, count: number): HTMLElement | null {
  if (!ctx.caps.textLayer || (count === 0 && !active)) return null;
  const b = el("button", {
    class: `status-tab tl-tab${active ? " active" : ""}`,
    type: "button",
    "aria-pressed": String(active),
    title: "Papers whose PDF has no text layer: search and text selection do not work in them",
    html: `${icon("file-no-text")}<span>No text</span><span class="n">${count}</span>`,
  });
  b.addEventListener("click", () => ctx.store.set({ noText: !ctx.store.get().noText }));
  return b;
}

function renderTabs(ctx: UiContext, container: HTMLElement, slice: { status: StatusFilter; noText: boolean }, scope: ListScope): void {
  const tabs = (["all", ...PAPER_STATUSES] as StatusFilter[]).map((key, i) => statusTab(ctx, key, i, slice.status === key, scope.counts[key]));
  const noText = noTextTab(ctx, slice.noText, scope.noTextCount);
  container.replaceChildren(...tabs, ...(noText ? [noText] : []));
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
    (s) => ({ folder: s.folder, folders: s.folders, papers: s.papers, query: s.query, status: s.status, noText: s.noText, includeSub: s.includeSub, pdfDirs: s.pdfDirs }),
    (slice) => {
      renderTabs(ctx, tabs, slice, deriveScope(slice));
      renderChips(ctx, strip, subfoldersOf(slice.folders, slice.folder, PAPERS_DIR, slice.papers.map((p) => p.path)));
    },
  );
}
