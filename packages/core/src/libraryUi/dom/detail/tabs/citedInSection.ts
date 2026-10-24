/** Renders the Cited in section: each writing project, file and heading that cites the paper, opening the source on click. */
import { escapeHtml } from "../../../../ui/index.js";
import type { Backlink } from "../../../../writing/index.js";
import { section } from "../detailMarkup.js";
import type { PaneState } from "../paneState.js";

function citedInRow(link: Backlink): string {
  const where = `${link.file}:${link.line + 1}`;
  return `<button class="rel-row" type="button" data-action="openSource" data-project="${escapeHtml(link.project)}"` +
    ` data-file="${escapeHtml(link.file)}" data-line="${link.line}" title="Open ${escapeHtml(where)}">` +
    `<span class="rel-main"><span class="rel-title">${escapeHtml(link.project)}${link.section ? ` <span class="rel-why">${escapeHtml(link.section)}</span>` : ""}</span>` +
    `<span class="rel-sub mono">${escapeHtml(where)}</span></span></button>`;
}

/** Empty when no project cites the paper or the host knows no projects. */
export function citedInSectionHtml(pane: PaneState, citedIn: readonly Backlink[] | undefined): string {
  if (!citedIn?.length) return "";
  return section("citedIn", "Cited in", citedIn.map(citedInRow).join(""), pane.collapsed, { count: citedIn.length });
}
