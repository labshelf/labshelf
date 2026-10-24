// Renders the list of works the library's papers often cite but the library lacks, each with its Import button.

import type { MissingWork } from "../../../import/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";
import type { CitationMapView } from "../../protocol/index.js";

const SHOWN_AUTHORS = 3;
const NO_DOI_TIP = "This work has no DOI, so LabShelf cannot import it";

/** "Ada Lovelace, Alan Turing, Grace Hopper et al. · 1950" */
function byline(work: MissingWork): string {
  const names = work.authors.slice(0, SHOWN_AUTHORS).join(", ") + (work.authors.length > SHOWN_AUTHORS ? " et al." : "");
  return [names, work.year].filter(Boolean).join(" · ");
}

function importButton(work: MissingWork): string {
  if (!work.doi) {
    return `<span class="cm-import-wrap" title="${NO_DOI_TIP}"><button class="ls-btn cm-import" type="button" disabled>Import</button></span>`;
  }
  return `<button class="ls-btn cm-import" type="button" data-act="import" data-work="${escapeHtml(work.workId)}" data-doi="${escapeHtml(work.doi)}" title="Import this paper into your library">Import</button>`;
}

function citedBy(work: MissingWork, titles: ReadonlyMap<string, string>, expanded: boolean): string {
  const items = work.citedBy.map((id) =>
    `<li><button class="cm-paper-link" type="button" data-act="open" data-id="${escapeHtml(id)}">${escapeHtml(titles.get(id) ?? id)}</button></li>`);
  return `<details class="cm-cited"${expanded ? " open" : ""}><summary>Cited by ${work.citedBy.length} of your papers</summary>` +
    `<ul>${items.join("")}</ul></details>`;
}

function rowMarkup(work: MissingWork, titles: ReadonlyMap<string, string>, expanded: boolean): string {
  const meta = byline(work);
  return `<li class="cm-row" data-work="${escapeHtml(work.workId)}" tabindex="-1"><div class="cm-row-text">` +
    `<div class="cm-title">${escapeHtml(work.title)}</div>` +
    (meta ? `<div class="cm-meta">${escapeHtml(meta)}</div>` : "") +
    `${citedBy(work, titles, expanded)}</div>${importButton(work)}</li>`;
}

/** Builds the list's markup; `open` names the works whose "Cited by" stays expanded across a repaint. */
export function missingWorkList(map: CitationMapView, open: ReadonlySet<string>): string {
  const titles = new Map(map.papers.map((p) => [p.id, p.title]));
  const html = map.missing.map((w) => rowMarkup(w, titles, open.has(w.workId))).join("");
  return `<ul class="cm-list" aria-label="Often cited by your papers, not in your library">${html}</ul>`;
}

/** Shows each Import button as busy while its work is being imported. */
export function markImporting(list: ParentNode, importing: ReadonlySet<string>): void {
  for (const btn of list.querySelectorAll<HTMLButtonElement>('button[data-act="import"]')) {
    const busy = importing.has(btn.dataset["work"] ?? "");
    if (busy === (btn.getAttribute("aria-busy") === "true")) continue;
    btn.disabled = busy;
    btn.setAttribute("aria-busy", String(busy));
    btn.innerHTML = busy ? `<span class="spin">${icon("loader")}</span><span>Importing…</span>` : "Import";
  }
}
