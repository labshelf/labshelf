// Builds the hover card that shows the library papers behind a citation.
import type { CitationCardPaper, CitationEntry } from "../../../index.js";
import { el } from "../../../../ui/dom/index.js";
import type { PopupContent } from "../hoverTarget.js";

export const OPEN_PAPER_LABEL = "Open paper";

/** Authors and year on one line; either may be missing. */
function byline(paper: CitationCardPaper): string {
  return [paper.authors.join(", "), paper.year === undefined ? "" : String(paper.year)].filter(Boolean).join(" · ");
}

function singleBody(entry: CitationEntry, paper: CitationCardPaper): HTMLElement {
  return el("div", { class: "rd-hover-cite" },
    el("p", { class: "rd-cite-title" }, paper.title),
    byline(paper) && el("p", { class: "rd-cite-byline" }, byline(paper)),
    paper.summary && el("p", { class: "rd-cite-summary" }, paper.summary),
    el("code", { class: "rd-cite-key" }, entry.key),
  );
}

function row(entry: CitationEntry, open: (paperId: string) => void): HTMLElement {
  const { paper } = entry;
  if (!paper) {
    return el("div", { class: "rd-cite-row" }, el("code", { class: "rd-cite-key" }, entry.key), el("span", { class: "rd-cite-missing" }, "Not in your library"));
  }
  const button = el("button", { class: "rd-cite-row rd-cite-row-paper", type: "button", "aria-label": `${OPEN_PAPER_LABEL}: ${paper.title}` },
    el("span", { class: "rd-cite-title" }, paper.title),
    byline(paper) && el("span", { class: "rd-cite-byline" }, byline(paper)),
    el("code", { class: "rd-cite-key" }, entry.key),
  );
  button.addEventListener("click", () => open(paper.id));
  return button;
}

/**
 * @returns the card for the entries, or null when none of them has a library paper.
 */
export function citationContent(entries: CitationEntry[], open: (paperId: string) => void): PopupContent | null {
  const first = entries.find((entry) => entry.paper);
  const only = entries.length === 1 ? entries[0] : undefined;
  if (!first?.paper) { return null; }
  if (only?.paper) {
    const paper = only.paper;
    return { title: "Cited paper", body: singleBody(only, paper), copyText: only.key, jump: () => open(paper.id), jumpLabel: OPEN_PAPER_LABEL };
  }
  const paperId = first.paper.id;
  return {
    title: "Cited papers",
    body: el("div", { class: "rd-hover-cites" }, ...entries.map((entry) => row(entry, open))),
    copyText: entries.map((entry) => entry.key).join(", "),
    jump: () => open(paperId),
    jumpLabel: OPEN_PAPER_LABEL,
  };
}
