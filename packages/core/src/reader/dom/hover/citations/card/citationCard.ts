// Builds the hover card that shows the library papers behind a citation.
import type { CitationEntry } from "../../../../index.js";
import { el } from "../../../../../ui/dom/index.js";
import type { PopupContent } from "../../hoverTarget.js";
import { citationActions, openAt, openLabel, OPEN_PAPER_LABEL, type PostRequest } from "./citationActions.js";
import { byline, citationHead } from "./citationHead.js";
import { citationTabs } from "./citationTabs.js";

export { OPEN_PAPER_LABEL };

function singleBody(entry: CitationEntry, open: (paperId: string, page?: number) => void, post: PostRequest | undefined): HTMLElement {
  const { paper } = entry;
  return el("div", { class: "rd-hover-cite" },
    citationHead(entry),
    ...(paper ? citationTabs(paper, entry.citedPage) : []),
    ...(post ? citationActions(entry, open, post) : []));
}

function row(entry: CitationEntry, open: (paperId: string, page?: number) => void): HTMLElement {
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
 * @returns the card for the entries, or null when none of them is a card subject; a build preview passes `post` so the card can
 * go to a source line and run its fix.
 */
export function citationContent(entries: CitationEntry[], open: (paperId: string, page?: number) => void, post?: PostRequest): PopupContent | null {
  const first = entries.find((entry) => entry.paper);
  const only = entries.length === 1 ? entries[0] : undefined;
  if (only && (only.paper || only.bib || only.fix)) {
    const { paper, site } = only;
    const jump = paper ? () => openAt(open, paper.id, only.citedPage)
      : () => { if (site) { post?.({ command: "openSourceLine", file: site.file, line: site.line }); } };
    return { title: paper ? "Cited paper" : "Cited key", body: singleBody(only, open, post), copyText: only.key, jump, jumpLabel: paper ? openLabel(only) : "Go to source" };
  }
  if (!first?.paper) { return null; }
  const paperId = first.paper.id;
  return {
    title: "Cited papers",
    body: el("div", { class: "rd-hover-cites" }, ...entries.map((entry) => row(entry, open))),
    copyText: entries.map((entry) => entry.key).join(", "),
    jump: () => open(paperId),
    jumpLabel: OPEN_PAPER_LABEL,
  };
}
