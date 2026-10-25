/**
 * @jest-environment jsdom
 */
// Tests the citation hover card for one paper, several entries and an entry without a library paper.
import { renderCitationContent, OPEN_PAPER_LABEL } from "../../../../../../src/reader/dom/hover/citations/card";
import type { CitationEntry } from "../../../../../../src/reader";

const smith: CitationEntry = {
  key: "smith2020",
  paper: { id: "p1", title: "Deep Shelves", authors: ["A. Smith", "B. Jones"], year: 2020 },
};
const lost: CitationEntry = { key: "ghost1999" };

describe("renderCitationContent", () => {
  it("shows one paper with its title and open action", () => {
    const open = jest.fn();
    const card = renderCitationContent([smith], open, jest.fn());
    expect(card?.title).toBe("Cited paper");
    expect(card?.body.querySelector(".rd-cite-title")?.textContent).toBe("Deep Shelves");
    expect(card?.copyText).toBe("smith2020");
    expect(card?.jumpLabel).toBe(OPEN_PAPER_LABEL);
    card?.jump();
    expect(open).toHaveBeenCalledWith("p1");
  });

  it("lists several entries, opening papers from buttons and marking the missing ones", () => {
    const open = jest.fn();
    const card = renderCitationContent([smith, lost], open, jest.fn());
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
    expect(renderCitationContent([lost], jest.fn(), jest.fn())).toBeNull();
    expect(renderCitationContent([], jest.fn(), jest.fn())).toBeNull();
  });
});

describe("renderCitationContent single-paper head", () => {
  const full: CitationEntry = {
    key: "smith2020",
    paper: { id: "p1", title: "Deep Shelves", authors: ["A. Smith", "B. Jones"], year: 2020, status: "reading" },
  };

  it("shows the title and the first surname with et al., without a status mark, key line or tabs", () => {
    const body = renderCitationContent([full], jest.fn(), jest.fn())!.body;
    expect(body.querySelector(".rd-cite-title")?.textContent).toBe("Deep Shelves");
    expect(body.querySelector(".rd-cite-byline")?.textContent).toBe("Smith et al. · 2020");
    expect(body.querySelector(".ls-arc-mark")).toBeNull();
    expect(body.querySelector(".rd-cite-key")).toBeNull();
    expect(body.querySelector("[role=tablist]")).toBeNull();
  });

  it("has no popup title bar", () => {
    expect(renderCitationContent([full], jest.fn(), jest.fn())?.bare).toBe(true);
  });
});
