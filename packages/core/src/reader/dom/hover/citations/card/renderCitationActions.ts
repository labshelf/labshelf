// Builds a citation card's actions (open the paper, go to the citing source line) and its one fix row.
import type { CitationCardFix, CitationEntry } from "../../../../index.js";
import type { PreviewRequest } from "../../../../previewRequests.js";
import { renderElement } from "../../../../../ui/dom/index.js";

export const OPEN_PAPER_LABEL = "Open paper";

export type PostRequest = (request: PreviewRequest) => void;

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const node = renderElement("button", { class: primary ? "rd-cite-btn rd-cite-btn-primary" : "rd-cite-btn", type: "button", text: label });
  node.addEventListener("click", onClick);
  return node;
}

/** @returns the label of the action that opens the cited paper, at the cited page when there is one. */
export function openLabel(entry: CitationEntry): string {
  return entry.citedPage === undefined ? OPEN_PAPER_LABEL : `Open at p. ${entry.citedPage}`;
}

/** Opens a cited paper, at `page` when the citation names one. */
export function openAt(open: (paperId: string, page?: number) => void, paperId: string, page: number | undefined): void {
  if (page === undefined) { open(paperId); } else { open(paperId, page); }
}

/** @returns the fix button for the entry, or null when the fix cannot run (a replacement needs the citing command). */
function fixButton(entry: CitationEntry, fix: CitationCardFix, post: PostRequest): HTMLButtonElement | null {
  const { key, site } = entry;
  switch (fix.kind) {
    case "replace":
      return site ? button(`Replace with ${fix.suggestion}`, () => post({ command: "fixCitation", fix: { kind: "replace", key, replacement: fix.suggestion, file: site.file, line: site.line } }), true) : null;
    case "update":
      return button(`Update to ${fix.venue}`, () => post({ command: "fixCitation", fix: { kind: "update", key } }), true);
    case "add":
      return button("Add to library", () => post({ command: "fixCitation", fix: { kind: "add", key } }), true);
  }
}

/** @returns the action row and the fix row for a card of a build preview; each is null when it has nothing to offer. */
export function renderCitationActions(entry: CitationEntry, open: (paperId: string, page?: number) => void, post: PostRequest): HTMLElement[] {
  const { paper, site, fix } = entry;
  const actions = [
    paper && button(openLabel(entry), () => openAt(open, paper.id, entry.citedPage)),
    site && button("Go to source", () => post({ command: "openSourceLine", file: site.file, line: site.line })),
  ].filter((node) => node !== undefined && node !== null);
  const fixNode = fix && fixButton(entry, fix, post);
  return [
    actions.length > 0 ? renderElement("div", { class: "rd-cite-acts" }, ...actions) : null,
    fixNode ? renderElement("div", { class: "rd-cite-fix" }, fixNode) : null,
  ].filter((node) => node !== null);
}
