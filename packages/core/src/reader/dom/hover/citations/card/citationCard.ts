// Builds the hover card that shows the library papers behind a citation.
import type { CitationEntry } from "../../../../index.js";
import { renderElement } from "../../../../../ui/dom/index.js";
import type { PopupContent } from "../../hoverAnchor.js";
import { renderCitationActions, openAt, openLabel, OPEN_PAPER_LABEL, type PostRequest } from "./renderCitationActions.js";
import { formatByline, renderCitationHead } from "./renderCitationHead.js";
import { renderFlatHighlights } from "./citationHighlights.js";

export { OPEN_PAPER_LABEL };

function singleBody(entry: CitationEntry, open: (paperId: string, page?: number) => void, post: PostRequest): HTMLElement {
  const { paper } = entry;
  return renderElement("div", { class: "rd-hover-cite rd-cite-flat" },
    renderCitationHead(entry),
    paper?.highlights?.length ? renderFlatHighlights(paper.highlights, entry.citedPage) : null,
    ...renderCitationActions(entry, open, post));
}

function row(entry: CitationEntry, open: (paperId: string, page?: number) => void): HTMLElement {
  const { paper } = entry;
  if (!paper) {
    return renderElement("div", { class: "rd-cite-row" }, renderElement("code", { class: "rd-cite-key" }, entry.key), renderElement("span", { class: "rd-cite-missing" }, "Not in your library"));
  }
  const button = renderElement("button", { class: "rd-cite-row rd-cite-row-paper", type: "button", "aria-label": `${OPEN_PAPER_LABEL}: ${paper.title}` },
    renderElement("span", { class: "rd-cite-title" }, paper.title),
    formatByline(paper) && renderElement("span", { class: "rd-cite-byline" }, formatByline(paper)),
    renderElement("code", { class: "rd-cite-key" }, entry.key),
  );
  button.addEventListener("click", () => open(paper.id));
  return button;
}

/**
 * @returns the card for the entries, or null when none of them is a card subject; `post` lets the card go to a source line and
 * run its fix.
 */
export function renderCitationContent(entries: CitationEntry[], open: (paperId: string, page?: number) => void, post: PostRequest): PopupContent | null {
  const first = entries.find((entry) => entry.paper);
  const only = entries.length === 1 ? entries[0] : undefined;
  if (only && (only.paper || only.bib || only.fix)) {
    const { paper, site } = only;
    const jump = paper ? () => openAt(open, paper.id, only.citedPage)
      : () => { if (site) { post({ command: "openSourceLine", file: site.file, line: site.line }); } };
    return { title: paper ? "Cited paper" : "Cited key", body: singleBody(only, open, post), copyText: only.key, jump, jumpLabel: paper ? openLabel(only) : "Go to source", bare: true };
  }
  if (!first?.paper) { return null; }
  const paperId = first.paper.id;
  return {
    title: "Cited papers",
    body: renderElement("div", { class: "rd-hover-cites" }, ...entries.map((entry) => row(entry, open))),
    copyText: entries.map((entry) => entry.key).join(", "),
    jump: () => open(paperId),
    jumpLabel: OPEN_PAPER_LABEL,
  };
}
