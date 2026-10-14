/**
 * The detail pane for several papers: how many, Move to and the copy and menu actions, their common status and
 * tags, the OCR banner, and the list of the selected papers.
 */
import type { PaperRecord } from "../../../model/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";
import { CITE_LABEL } from "../flows/index.js";
import { KEY_HINT } from "../uiContext.js";
import { iconBtn, statusSeg } from "./detailMarkup.js";
import { selectionBanner, tagRowHtml } from "./head/index.js";
import type { PaneState } from "./paneState.js";
import { paperLine } from "./tabs/index.js";

/** The tags every paper in the selection has, in the first paper's order. */
export function commonTags(papers: readonly PaperRecord[]): string[] {
  const [first, ...rest] = papers;
  return (first?.tags ?? []).filter((t) => rest.every((p) => (p.tags ?? []).some((x) => x.toLowerCase() === t.toLowerCase())));
}

export function selectedPapers(pane: PaneState, ids: readonly string[]): PaperRecord[] {
  const byId = new Map(pane.ctx.store.get().papers.map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is PaperRecord => !!p);
}

export function multiDetailHtml(pane: PaneState, ids: string[]): string {
  const papers = selectedPapers(pane, ids);
  const status = papers.every((p) => p.status === papers[0]?.status) ? papers[0]?.status ?? null : null;
  return `<div class="detail-head">` +
    `<div class="detail-title">${escapeHtml(String(ids.length))} papers selected</div>` +
    `<div class="detail-byline muted-text">Drag them onto a subfolder chip or a path segment, or use the actions below.</div>` +
    `<div class="detail-toolbar"><button class="ls-btn ls-btn-primary" type="button" data-action="move">${icon("folder-move")}<span>Move to…</span></button><span class="tb-spacer"></span>` +
      iconBtn("copyKey", "key", `Copy all cite keys (${KEY_HINT.mod}C)`) +
      iconBtn("copyCite", "quote", `Copy all as ${CITE_LABEL[pane.citeFormat]}`) +
      iconBtn("more", "more", "More actions") +
    `</div>` +
    statusSeg(status) + tagRowHtml(pane.ctx, commonTags(papers)) + (pane.ctx.caps.textLayer ? selectionBanner(pane.ctx, ids) : "") +
  `</div>` +
  `<div class="sel-list">${papers.map((p) => paperLine(p, "selectOnly", "Show only this paper")).join("")}</div>`;
}
