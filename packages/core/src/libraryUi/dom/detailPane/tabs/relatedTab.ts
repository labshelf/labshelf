/**
 * Renders the Related tab: papers with similar content (when the host finds them), the same authors, shared tags and
 * keywords, and the same venue. A click selects the paper where it lives; a double-click opens it.
 */
import { formatAuthors } from "../../../../library/index.js";
import { type PaperRecord } from "../../../../model/index.js";
import { STATUS_LABEL } from "../../../../library/record.js";
import { escapeHtml, renderIcon } from "../../../../ui/index.js";
import { deriveRelatedGroups } from "../../../viewModel/index.js";
import { renderIconButton, renderLoading, renderSection } from "../detailPaneMarkup.js";
import type { PaneState, PaperView } from "../paneState.js";

/** One paper in a list of papers, as Related and a multi-selection show them. */
export function renderPaperLine(q: PaperRecord, action: string, title: string, why = ""): string {
  return `<div class="rel-row" data-action="${action}" data-id="${escapeHtml(q.id)}" title="${escapeHtml(title)}">` +
    `<span class="ls-dot s-${q.status}" title="${STATUS_LABEL[q.status]}"></span>` +
    `<div class="rel-main"><div class="rel-title">${escapeHtml(q.title)}</div>` +
      `<div class="rel-sub">${escapeHtml([formatAuthors(q.authors), q.year].filter(Boolean).join(" · "))}${why ? `<span class="rel-why">${escapeHtml(why)}</span>` : ""}</div></div>` +
    (action === "openRelated" ? renderIconButton("open", "book-open", "Open PDF", ` data-id="${escapeHtml(q.id)}"`) : "") + `</div>`;
}

const relRow = (q: PaperRecord, why = ""): string => renderPaperLine(q, "openRelated", "Show this paper — double-click to open it", why);

export function renderRelatedTabHtml(pane: PaneState, v: PaperView): string {
  const g = deriveRelatedGroups(v.p, v.library, v.similar ?? []);
  const c = pane.collapsed;
  let html = "";
  if (pane.ctx.caps.similar && v.similar === null) html += renderSection("relSimilar", "Similar content", renderLoading("Searching the AI index…"), c);
  else if (g.similar.length) html += renderSection("relSimilar", "Similar content", g.similar.map((x) => relRow(x.paper, `${Math.round(x.score * 100)}% match`)).join(""), c, { count: g.similar.length });
  if (g.authors.length) html += renderSection("relAuthors", "Same authors", g.authors.map((q) => relRow(q)).join(""), c, { count: g.authors.length });
  if (g.shared.length) html += renderSection("relShared", "Shared tags & keywords", g.shared.map((x) => relRow(x.paper, x.common.join(", "))).join(""), c, { count: g.shared.length });
  if (g.venue.length) html += renderSection("relVenue", "Same venue", g.venue.map((q) => relRow(q)).join(""), c, { count: g.venue.length });
  return html || `<div class="tab-empty">${renderIcon("link")}<div>No related papers yet.</div><div class="muted-text">Papers that share authors, tags or keywords, or the venue with this one appear here. Tagging papers helps.</div></div>`;
}
