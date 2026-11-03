/**
 * The detail pane's shared base: the state it keeps (open tab, citation style, folds, filters) with the data one paper's views
 * render from, and the markup pieces every part reuses (sections, fields, icon and copy buttons, muted and loading lines).
 */
import { PAPERS_DIR } from "../../../library/index.js";
import type { AnnotationColor, PaperRecord } from "../../../model/index.js";
import { listPapersUnder, type ListPaper } from "../../listModel.js";
import type { PaperDetails, PaperStats, SimilarPaper, TextLayerJobView } from "../../protocol/index.js";
import { listPlacePapers, type CitationFormat, type DetailsTab } from "../../store/index.js";
import type { UiContext } from "../uiContext.js";
import { escapeHtml, renderIcon, type IconName } from "../../../ui/index.js";

export interface PaneState {
  ctx: UiContext;
  el: HTMLElement;
  tab: DetailsTab;
  citeFormat: CitationFormat;
  collapsed: Record<string, boolean>;
  abstractOpen: boolean;
  authorsOpen: boolean;
  annFilter: string;
  annColor: AnnotationColor | null;
  /** The tag row shows its field rather than the Add tag button. */
  tagEditing: boolean;
  /** The selection the pane shows, as sorted ids. */
  key: string;
  /** A render was skipped while a button was pressed. */
  stale: boolean;
}

/** Everything a single paper's views read. */
export interface PaperView {
  p: ListPaper;
  stats: PaperStats | undefined;
  details: PaperDetails | undefined;
  job: TextLayerJobView | undefined;
  /** undefined: not asked; null: the host is searching. */
  similar: SimilarPaper[] | null | undefined;
  library: PaperRecord[];
  openFolder: string;
  pdfBusy: boolean;
}

export function derivePaperView(ctx: UiContext, id: string): PaperView | null {
  const s = ctx.store.get();
  const p = listPapersUnder(listPlacePapers(s), PAPERS_DIR, s.pdfDirs).find((q) => q.id === id);
  if (!p) return null;
  return {
    p, stats: s.stats[id], details: s.details[id], job: s.jobs[id], similar: s.similar[id], library: s.papers,
    openFolder: s.folder, pdfBusy: s.pdfBusy.has(id),
  };
}

export interface SectionOptions {
  count?: number;
}

/** A section, open unless the user folded it. */
export function renderSection(id: string, title: string, body: string, collapsed: Record<string, boolean>, o: SectionOptions = {}): string {
  const closed = !!collapsed[id];
  return `<div class="detail-section">` +
    `<div class="sec-head${closed ? " collapsed" : ""}" data-sec="${id}" role="button" tabindex="0" aria-expanded="${!closed}">` +
      `<span class="sec-chevron">${renderIcon("chevron-down")}</span>` +
      `<span class="sec-title">${escapeHtml(title)}</span>` +
      (o.count ? `<span class="sec-count">${o.count}</span>` : "") +
    `</div>` +
    `<div class="sec-body${closed ? " hidden" : ""}" data-sec-body="${id}">${body}</div></div>`;
}

export function renderField(label: string, valueHtml: string): string {
  return `<div class="kv-label">${escapeHtml(label)}</div><div class="kv-value">${valueHtml}</div>`;
}

export function renderIconButton(action: string, name: IconName, title: string, attrs = ""): string {
  return `<button class="ls-icon-btn" type="button" data-action="${action}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"${attrs}>${renderIcon(name)}</button>`;
}

export function copyBtn(text: string, label: string): string {
  return renderIconButton("copyField", "copy", `Copy ${label}`, ` data-text="${escapeHtml(text)}" data-label="${escapeHtml(label)}"`);
}

export function renderMuted(text: string): string {
  return `<div class="muted-note">${escapeHtml(text)}</div>`;
}

export function renderLoading(text = "Loading…"): string {
  return `<div class="muted-note pane-loading"><span class="spin">${renderIcon("loader")}</span>${escapeHtml(text)}</div>`;
}
