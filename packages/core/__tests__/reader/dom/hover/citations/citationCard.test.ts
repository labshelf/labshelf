/**
 * @jest-environment jsdom
 */
// Tests the citation hover card for one paper, several entries and an entry without a library paper.
import { citationContent, OPEN_PAPER_LABEL } from "../../../../../src/reader/dom/hover/citations/citationCard";
import type { CitationEntry } from "../../../../../src/reader";

const smith: CitationEntry = {
  key: "smith2020",
  paper: { id: "p1", title: "Deep Shelves", authors: ["A. Smith", "B. Jones"], year: 2020, summary: "A study of shelves." },
};
const lost: CitationEntry = { key: "ghost1999" };

describe("citationContent", () => {
  it("shows one paper with authors, year, summary and key", () => {
    const open = jest.fn();
    const card = citationContent([smith], open);
    expect(card?.title).toBe("Cited paper");
    expect(card?.body.querySelector(".rd-cite-title")?.textContent).toBe("Deep Shelves");
    expect(card?.copyText).toBe("smith2020");
    expect(card?.jumpLabel).toBe(OPEN_PAPER_LABEL);
    expect(card?.body.querySelector(".rd-cite-byline")?.textContent).toBe("A. Smith, B. Jones · 2020");
    expect(card?.body.querySelector(".rd-cite-summary")?.textContent).toBe("A study of shelves.");
    expect(card?.body.querySelector(".rd-cite-key")?.textContent).toBe("smith2020");
    card?.jump();
    expect(open).toHaveBeenCalledWith("p1");
  });

  it("lists several entries, opening papers from buttons and marking the missing ones", () => {
    const open = jest.fn();
    const card = citationContent([smith, lost], open);
    expect(card?.title).toBe("Cited papers");
    const rows = [...(card?.body.children ?? [])];
    expect(rows).toHaveLength(2);
    const button = rows[0] as HTMLButtonElement;
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-label")).toBe("Open paper: Deep Shelves");
    button.click();
    expect(open).toHaveBeenCalledWith("p1");
    expect(rows[1]?.tagName).toBe("DIV");
    expect(rows[1]?.textContent).toContain("ghost1999");
    expect(rows[1]?.textContent).toContain("Not in your library");
    card?.jump();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("has no card when no entry has a library paper", () => {
    expect(citationContent([lost], jest.fn())).toBeNull();
    expect(citationContent([], jest.fn())).toBeNull();
  });
});

describe("citationContent single-paper tabs", () => {
  const full: CitationEntry = {
    key: "smith2020",
    paper: {
      id: "p1", title: "Deep Shelves", authors: ["A. Smith"], year: 2020, status: "reading", summary: "A study of shelves.",
      highlights: [{ text: "Shelves bend.", page: 3 }, { text: "Books weigh.", page: 7 }],
      citedIn: ["Introduction", "Related work"],
    },
  };
  const bare: CitationEntry = { key: "doe19", paper: { id: "p2", title: "Plain", authors: [] } };

  function render(entry: CitationEntry) {
    document.body.innerHTML = "";
    const body = citationContent([entry], jest.fn())!.body;
    document.body.append(body);
    const tabs = [...body.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    const panels = [...body.querySelectorAll<HTMLElement>("[role=tabpanel]")];
    const shown = () => panels.filter((p) => !p.hidden);
    return { body, tabs, panels, shown };
  }

  it("heads the card with the Arc mark of the paper status, the title, byline and key", () => {
    const { body } = render(full);
    const mark = body.querySelector(".rd-cite-head .ls-arc-mark");
    expect(mark?.getAttribute("aria-label")).toBe("Reading");
    expect(mark?.querySelector(".ls-arc-accent")).not.toBeNull();
    expect(body.querySelector(".rd-cite-head .rd-cite-title")?.textContent).toBe("Deep Shelves");
    expect(body.querySelector(".rd-cite-head .rd-cite-key")?.textContent).toBe("smith2020");
  });

  it("omits the Arc mark when the host sends no status", () => {
    expect(render(bare).body.querySelector(".ls-arc-mark")).toBeNull();
  });

  it("offers Highlights, Abstract and Cited in tabs, each controlling its panel", () => {
    const { body, tabs, panels } = render(full);
    expect(body.querySelector("[role=tablist]")?.getAttribute("aria-label")).toBe("Cited paper details");
    expect(tabs.map((t) => t.textContent)).toEqual(["Highlights", "Abstract", "Cited in"]);
    tabs.forEach((tab, i) => {
      expect(tab.getAttribute("aria-controls")).toBe(panels[i]?.id);
      expect(panels[i]?.getAttribute("aria-labelledby")).toBe(tab.id);
    });
    expect(new Set(panels.map((p) => p.id)).size).toBe(3);
  });

  it("lists highlights with their page, and section titles", () => {
    const { panels } = render(full);
    const quotes = [...panels[0]!.querySelectorAll("li")];
    expect(quotes.map((q) => q.querySelector(".rd-cite-quote")?.textContent)).toEqual(["Shelves bend.", "Books weigh."]);
    expect(quotes.map((q) => q.querySelector(".rd-cite-page")?.textContent)).toEqual(["p. 3", "p. 7"]);
    expect(panels[1]?.querySelector(".rd-cite-summary")?.textContent).toBe("A study of shelves.");
    expect([...panels[2]!.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Introduction", "Related work"]);
  });

  it("opens on the first tab with content", () => {
    expect(render(full).shown()[0]?.getAttribute("aria-labelledby")).toMatch(/highlights/);
    const abstractOnly = render({ key: "k", paper: { id: "p", title: "T", authors: [], summary: "S." } });
    expect(abstractOnly.shown().map((p) => p.querySelector(".rd-cite-summary")?.textContent)).toEqual(["S."]);
    const citedOnly = render({ key: "k", paper: { id: "p", title: "T", authors: [], citedIn: ["Methods"] } });
    expect(citedOnly.tabs[2]?.getAttribute("aria-selected")).toBe("true");
    expect(render(bare).tabs[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("shows a muted empty state in every tab without content", () => {
    const { panels } = render(bare);
    expect(panels.map((p) => p.querySelector(".rd-cite-empty")?.textContent)).toEqual(["No highlights", "No abstract", "No sections"]);
  });

  it("switches panels by click and by arrow keys, without the keys reaching the page", () => {
    const { tabs, shown } = render(full);
    tabs[1]?.click();
    expect(shown().map((p) => p.querySelector(".rd-cite-summary")?.textContent)).toEqual(["A study of shelves."]);
    const pageKeys = jest.fn();
    document.addEventListener("keydown", pageKeys);
    tabs[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    document.removeEventListener("keydown", pageKeys);
    expect(tabs[2]?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[2]);
    expect(shown()).toHaveLength(1);
    expect(shown()[0]?.querySelectorAll("li")).toHaveLength(2);
    expect(pageKeys).not.toHaveBeenCalled();
  });
});
