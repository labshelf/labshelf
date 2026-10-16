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
