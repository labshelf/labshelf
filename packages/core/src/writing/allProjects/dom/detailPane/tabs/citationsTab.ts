// Builds the Citations tab of the All projects detail pane: one row per cited key, saying where it resolves.
import { renderMuted } from "../../../../../libraryUi/dom/index.js";
import { escapeHtml } from "../../../../../ui/index.js";
import type { ProjectCitation, ProjectDetail } from "../../../projectDetailPane.js";

function citationRow(c: ProjectCitation, bibFile: string | undefined): string {
  const missing = c.source === "none" ? `<span class="cite-missing">Not found</span>` : "";
  const text = [c.title, c.authors, c.year].filter(Boolean).map(escapeHtml).join(" · ");
  const from = c.source === "bib" && bibFile ? `<span class="cite-source">from ${escapeHtml(bibFile)}</span>` : "";
  return `<div class="ls-cite-row${missing ? " missing" : ""}" role="listitem">${missing}<span class="cite-key">${escapeHtml(c.key)}</span>` +
    (text ? `<span class="cite-text">${text}</span>` : "") + from + `</div>`;
}

export function citationsTabHtml(detail: ProjectDetail): string {
  if (detail.citations.length === 0) return renderMuted("No citations yet.");
  return `<div class="ls-cite-list" role="list">${detail.citations.map((c) => citationRow(c, detail.bibliography?.file)).join("")}</div>`;
}
