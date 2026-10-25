// Renders a paper's highlights for a citation card: those on the cited page first, the rest folded.
import type { CitationCardPaper } from "../../../../index.js";
import { renderElement } from "../../../../../ui/dom/index.js";
import { renderIcon } from "../../../../../ui/index.js";

type Highlight = NonNullable<CitationCardPaper["highlights"]>[number];

/** The colour is the only thing a highlight says about itself, so it shows as a swatch with no label. */
function item(highlight: Highlight): HTMLElement {
  return renderElement("li", { class: `rd-cite-highlight${highlight.color ? ` rd-cite-hl-${highlight.color}` : ""}` },
    renderElement("span", { class: "rd-cite-quote", text: highlight.text }),
    renderElement("span", { class: "rd-cite-page", text: `p. ${highlight.page}` }));
}

const list = (highlights: Highlight[]): HTMLElement => renderElement("ul", { class: "rd-cite-list" }, ...highlights.map(item));

/** @returns the highlights in one list, or, when a page is cited, that page's highlights above a folded group of the others. */
export function renderHighlightsPanel(highlights: Highlight[], citedPage: number | undefined): HTMLElement {
  if (citedPage === undefined) { return renderElement("div", { class: "rd-cite-highlights" }, list(highlights)); }
  const onPage = highlights.filter((h) => h.page === citedPage);
  const others = highlights.filter((h) => h.page !== citedPage);
  return renderElement("div", { class: "rd-cite-highlights" },
    onPage.length ? list(onPage) : renderElement("p", { class: "rd-cite-empty", text: "None on this page" }),
    others.length > 0 && renderElement("details", {}, renderElement("summary", {}, renderElement("span", { class: "rd-cite-chevron", html: renderIcon("chevron-right") }), `Other highlights (${others.length})`), list(others)));
}

/** The preview card's highlights: a label naming the cited page above the highlights panel. */
export function renderFlatHighlights(highlights: Highlight[], citedPage: number | undefined): HTMLElement {
  return renderElement("div", { class: "rd-cite-flat-highlights" },
    renderElement("p", { class: "rd-cite-label", text: citedPage === undefined ? "Your highlights" : `Your highlights on p. ${citedPage}` }),
    renderHighlightsPanel(highlights, citedPage));
}
