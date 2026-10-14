/**
 * The Related tab: papers with similar content (when the host finds them), the same authors, shared tags and
 * keywords, and the same venue. A click selects the paper where it lives; a double-click opens it.
 */
import { formatAuthors } from "../../../../library/index.js";
import { STATUS_LABEL, type PaperRecord } from "../../../../model/index.js";
import { escapeHtml, icon } from "../../../../ui/index.js";
import { relatedGroups } from "../../../derive/index.js";
import { iconBtn, loading, section } from "../detailMarkup.js";
import type { PaneState, PaperView } from "../paneState.js";

/** One paper in a list of papers, as Related and a multi-selection show them. */
export function paperLine(q: PaperRecord, action: string, title: string, why = ""): string {
  return `<div class="rel-row" data-action="${action}" data-id="${escapeHtml(q.id)}" title="${escapeHtml(title)}">` +
    `<span class="ls-dot s-${q.status}" title="${STATUS_LABEL[q.status]}"></span>` +
    `<div class="rel-main"><div class="rel-title">${escapeHtml(q.title)}</div>` +
      `<div class="rel-sub">${escapeHtml([formatAuthors(q.authors), q.year].filter(Boolean).join(" · "))}${why ? `<span class="rel-why">${escapeHtml(why)}</span>` : ""}</div></div>` +
    (action === "openRelated" ? iconBtn("open", "book-open", "Open PDF", ` data-id="${escapeHtml(q.id)}"`) : "") + `</div>`;
}

const relRow = (q: PaperRecord, why = ""): string => paperLine(q, "openRelated", "Show this paper — double-click to open it", why);

export function relatedTabHtml(pane: PaneState, v: PaperView): string {
  const g = relatedGroups(v.p, v.library, v.similar ?? []);
  const c = pane.collapsed;
  let html = "";
  if (pane.ctx.caps.similar && v.similar === null) html += section("relSimilar", "Similar content", loading("Searching the AI index…"), c);
  else if (g.similar.length) html += section("relSimilar", "Similar content", g.similar.map((x) => relRow(x.paper, `${Math.round(x.score * 100)}% match`)).join(""), c, { count: g.similar.length });
  if (g.authors.length) html += section("relAuthors", "Same authors", g.authors.map((q) => relRow(q)).join(""), c, { count: g.authors.length });
  if (g.shared.length) html += section("relShared", "Shared tags & keywords", g.shared.map((x) => relRow(x.paper, x.common.join(", "))).join(""), c, { count: g.shared.length });
  if (g.venue.length) html += section("relVenue", "Same venue", g.venue.map((q) => relRow(q)).join(""), c, { count: g.venue.length });
  return html || `<div class="tab-empty">${icon("link")}<div>No related papers yet.</div><div class="muted-text">Papers that share authors, tags or keywords, or the venue with this one appear here. Tagging papers helps.</div></div>`;
}
