// Builds a cited paper's detail tabs: its highlights, its abstract and the project sections that cite it.
import type { CitationCardPaper } from "../../../../index.js";
import { el } from "../../../../../ui/dom/index.js";
import { TabList } from "../../../chrome/index.js";
import { highlightsPanel } from "./citationHighlights.js";

type DetailTab = "highlights" | "abstract" | "citedIn";

interface DetailSpec {
  id: DetailTab;
  label: string;
  has: (paper: CitationCardPaper) => boolean;
  render: (paper: CitationCardPaper, citedPage: number | undefined) => HTMLElement;
}

const empty = (text: string): HTMLElement => el("p", { class: "rd-cite-empty", text });

const DETAILS: readonly DetailSpec[] = [
  {
    id: "highlights",
    label: "Highlights",
    has: (paper) => (paper.highlights?.length ?? 0) > 0,
    render: (paper, citedPage) => paper.highlights?.length ? highlightsPanel(paper.highlights, citedPage) : empty("No highlights"),
  },
  {
    id: "abstract",
    label: "Abstract",
    has: (paper) => Boolean(paper.summary),
    render: (paper) => paper.summary ? el("p", { class: "rd-cite-summary", text: paper.summary }) : empty("No abstract"),
  },
  {
    id: "citedIn",
    label: "Cited in",
    has: (paper) => (paper.citedIn?.length ?? 0) > 0,
    render: (paper) => paper.citedIn?.length
      ? el("ul", { class: "rd-cite-list" }, ...paper.citedIn.map((title) => el("li", { text: title })))
      : empty("No sections"),
  },
];

// Several cards may exist at once (one closing, one opening), so tab and panel ids carry a per-card number.
let cardCount = 0;

/** @returns the tab strip followed by one panel per tab, opened on the first tab with content. */
export function citationTabs(paper: CitationCardPaper, citedPage?: number): HTMLElement[] {
  const prefix = `rd-cite-${++cardCount}`;
  const panels = new Map(DETAILS.map((d) => [d.id, el("div", {
    class: "rd-cite-panel", role: "tabpanel", tabindex: "0", id: `${prefix}-${d.id}-panel`, "aria-labelledby": `${prefix}-${d.id}-tab`,
  }, d.render(paper, citedPage))]));
  const show = (id: DetailTab): void => panels.forEach((panel, key) => { panel.hidden = key !== id; });
  const first = DETAILS.find((d) => d.has(paper))?.id;
  const tabs = new TabList(
    DETAILS.map((d) => ({ id: d.id, label: d.label, controls: `${prefix}-${d.id}-panel` })),
    { label: "Cited paper details", onSelect: show, ...(first ? { selected: first } : {}) },
  );
  DETAILS.forEach((d) => { tabs.button(d.id).id = `${prefix}-${d.id}-tab`; });
  tabs.el.classList.add("rd-cite-tabs");
  // TRAP: the hover popup closes on any keydown that reaches the document, so keys the tabs used stop here.
  tabs.el.addEventListener("keydown", (e) => { if (e.defaultPrevented) { e.stopPropagation(); } });
  show(tabs.selected);
  return [tabs.el, ...panels.values()];
}
