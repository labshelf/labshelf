/**
 * The detail pane: the selected paper (head, tabs) or a multi-selection, rebuilt from the store on every change.
 * Scroll, focus and caret survive a rebuild, and nothing is rebuilt under a note being typed or a button being pressed.
 */
import { escapeHtml, icon } from "../../../ui/index.js";
import type { UiContext } from "../uiContext.js";
import { KEY_HINT } from "../uiContext.js";
import { runDetailAction } from "./detailActions.js";
import { onTagInput, onTagKey, paperHeadHtml } from "./head/index.js";
import { commonTags, multiDetailHtml, selectedPapers } from "./multiDetail.js";
import { createNoteEditor } from "./noteEditor.js";
import { paperView, shownTab, type PaneState } from "./paneState.js";
import { annotationListHtml, annotationsTabHtml, detailsTabHtml, notesTabHtml, relatedTabHtml, tabBarHtml } from "./tabs/index.js";

const PLACEHOLDER = `<div class="detail-placeholder"><div class="ls-empty-icon">${icon("book")}</div>` +
  `<div>Select a paper to see its details, annotations, notes and related papers.</div><div class="kbd-help">` +
  `<span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>/</kbd> search</span>` +
  `<span><kbd>${escapeHtml(KEY_HINT.mod)}C</kbd> copy key</span><span><kbd>${escapeHtml(KEY_HINT.alt)}1–3</kbd> status</span></div></div>`;

function singleHtml(pane: PaneState, id: string): string {
  pane.ctx.data.ensureDetails(id);
  const tab = shownTab(pane);
  if (tab === "related") pane.ctx.data.ensureSimilar(id);
  const v = paperView(pane.ctx, id);
  if (!v) return "";
  const body = tab === "annotations" ? annotationsTabHtml(pane, v)
    : tab === "notes" ? notesTabHtml(pane, v)
    : tab === "related" ? relatedTabHtml(pane, v)
    : detailsTabHtml(pane, v);
  return paperHeadHtml(pane, v) + tabBarHtml(pane, v) + `<div class="tab-body">${body}</div>`;
}

interface Pane extends PaneState {
  pointerDown: boolean;
}

function render(pane: Pane): void {
  const ids = [...pane.ctx.store.get().selected];
  const key = [...ids].sort().join("|");
  const active = document.activeElement as HTMLInputElement | null;
  const inPane = !!active && pane.el.contains(active);
  if (key === pane.key && (pane.pointerDown || (inPane && active.classList.contains("note-input")))) { pane.stale = true; return; }
  if (key !== pane.key) {
    pane.notes.flush();
    Object.assign(pane, { key, abstractOpen: false, authorsOpen: false, annFilter: "", annColor: null });
    pane.el.scrollTop = 0;
  }
  pane.stale = false;
  const keep = inPane && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")
    ? { cls: active.classList[0]!, start: active.selectionStart, end: active.selectionEnd } : null;
  const scroll = pane.el.scrollTop;
  pane.el.innerHTML = ids.length === 0 ? PLACEHOLDER : ids.length > 1 ? multiDetailHtml(pane, ids) : singleHtml(pane, ids[0]!);
  pane.el.scrollTop = scroll;
  if (!keep) return;
  const field = pane.el.querySelector<HTMLInputElement>(`.${keep.cls}`);
  field?.focus();
  if (field && keep.start !== null) field.setSelectionRange(keep.start, keep.end);
}

function toggleSection(pane: Pane, head: HTMLElement): void {
  const sec = head.dataset["sec"]!;
  const closed = !pane.collapsed[sec];
  pane.collapsed = { ...pane.collapsed, [sec]: closed };
  pane.ctx.prefs.save({ secCollapsed: pane.collapsed });
  head.classList.toggle("collapsed", closed);
  head.setAttribute("aria-expanded", String(!closed));
  pane.el.querySelector(`[data-sec-body="${sec}"]`)?.classList.toggle("hidden", closed);
}

function onClick(pane: Pane, e: MouseEvent): void {
  const target = e.target as HTMLElement;
  const el = target.closest<HTMLElement>("[data-action]");
  if (el && !(el as HTMLButtonElement).disabled && pane.ctx.store.get().selected.size > 0) {
    // Links keep their own navigation; everything else is ours.
    if (el.tagName !== "A") e.preventDefault();
    e.stopPropagation();
    runDetailAction(pane, el, () => render(pane));
    if (el.dataset["action"] === "tab") {
      // Deep in a long tab, switching lands at the top of the new one, under the sticky tab bar.
      const bar = pane.el.querySelector<HTMLElement>(".detail-tabs");
      if (bar) pane.el.scrollTop = Math.min(pane.el.scrollTop, bar.offsetTop);
    }
    return;
  }
  const head = target.closest<HTMLElement>(".sec-head");
  if (head) toggleSection(pane, head);
}

function onKey(pane: Pane, e: KeyboardEvent): void {
  const t = e.target as HTMLElement;
  const ids = [...pane.ctx.store.get().selected];
  if (t.classList.contains("sec-head") && (e.key === "Enter" || e.key === " ")) { toggleSection(pane, t); e.preventDefault(); return; }
  if (t.classList.contains("tag-input")) {
    const tags = ids.length === 1 ? selectedPapers(pane, ids)[0]?.tags ?? [] : commonTags(selectedPapers(pane, ids));
    onTagKey(pane.ctx, e, t as HTMLInputElement, ids, tags);
  } else if (t.classList.contains("note-input") && e.key === "Escape") {
    pane.notes.flush();
    pane.ctx.focusList();
    e.preventDefault();
  } else if (t.classList.contains("ann-filter") && e.key === "Escape") {
    (t as HTMLInputElement).value = "";
    onAnnFilter(pane, "");
    pane.ctx.focusList();
    e.preventDefault();
  }
}

// The filter narrows the list in place, so the field keeps its focus and caret.
function onAnnFilter(pane: Pane, value: string): void {
  pane.annFilter = value;
  const details = pane.ctx.store.get().details[[...pane.ctx.store.get().selected][0] ?? ""];
  const list = pane.el.querySelector(".ann-list");
  if (list && details) list.innerHTML = annotationListHtml(pane, details.annotations);
}

function onInput(pane: Pane, e: Event): void {
  const t = e.target as HTMLInputElement;
  const ids = [...pane.ctx.store.get().selected];
  if (t.classList.contains("note-input") && ids[0]) pane.notes.changed(ids[0], t.value);
  else if (t.classList.contains("ann-filter")) onAnnFilter(pane, t.value);
  else if (t.classList.contains("tag-input")) onTagInput(pane.ctx, t, ids);
}

// A rebuild skipped while the note had focus or a button was pressed runs once both are over; after the click, so
// replacing the pressed button cannot swallow it.
function wirePointer(pane: Pane): () => void {
  const catchUp = (): void => { if (pane.stale && !pane.pointerDown) render(pane); };
  const onUp = (): void => {
    if (!pane.pointerDown) return;
    pane.pointerDown = false;
    setTimeout(catchUp, 0);
  };
  pane.el.addEventListener("mousedown", () => { pane.pointerDown = true; }, true);
  pane.el.addEventListener("focusout", (e) => {
    if (!(e.target as HTMLElement).classList.contains("note-input")) return;
    pane.notes.flush();
    if (!pane.pointerDown) setTimeout(catchUp, 0);
  });
  document.addEventListener("mouseup", onUp, true);
  return () => document.removeEventListener("mouseup", onUp, true);
}

/** Mounts the detail pane and returns the function that unmounts it. */
export function mountDetailPane(ctx: UiContext, container: HTMLElement): () => void {
  const saved = ctx.prefs.load();
  const pane: Pane = {
    ctx, el: container, tab: saved.detailTab, citeFormat: saved.citeFormat, collapsed: saved.secCollapsed,
    abstractOpen: false, authorsOpen: false, annFilter: "", annColor: null, key: "\u0000", stale: false, pointerDown: false,
    notes: createNoteEditor(ctx, container),
  };
  container.addEventListener("click", (e) => onClick(pane, e));
  container.addEventListener("dblclick", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".rel-row[data-id]");
    if (row && !(e.target as HTMLElement).closest(".ls-icon-btn")) ctx.transport.post({ type: "paper.open", id: row.dataset["id"]! });
  });
  container.addEventListener("keydown", (e) => onKey(pane, e));
  container.addEventListener("input", (e) => onInput(pane, e));
  const offPointer = wirePointer(pane);
  const off = ctx.store.select(
    (s) => ({ selected: s.selected, papers: s.papers, stats: s.stats, details: s.details, similar: s.similar, jobs: s.jobs, folder: s.folder, pdfDirs: s.pdfDirs, pdfBusy: s.pdfBusy }),
    () => render(pane),
  );
  return () => { off(); offPointer(); pane.notes.dispose(); };
}
