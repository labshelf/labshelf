/**
 * @jest-environment jsdom
 */
// Tests the citation card of a build preview: tag, venue and folder, citing command, page-first highlights, actions and fix row.
import { citationContent } from "../../../../../../src/reader/dom/hover/citations/card";
import type { CitationEntry } from "../../../../../../src/reader";

const site = { file: "chapters/intro.tex", line: 42, text: "\\cite[p.~3]{smith2020}" };
const paper: NonNullable<CitationEntry["paper"]> = {
  id: "p1", title: "Deep Shelves", authors: ["A. Smith"], year: 2020, venue: "NeurIPS", folder: "Thesis",
  highlights: [
    { text: "Shelves bend.", page: 3, color: "yellow" },
    { text: "Books weigh.", page: 3, color: "green" },
    { text: "Wood warps.", page: 7, color: "blue" },
  ],
};
const entry: CitationEntry = { key: "smith2020", paper, site, citedPage: 3 };
const noPage: CitationEntry = { key: "smith2020", paper, site };
const noSite: CitationEntry = { key: "smith2020", paper, citedPage: 3 };

function render(e: CitationEntry, open = jest.fn(), post: jest.Mock | null = jest.fn()) {
  document.body.innerHTML = "";
  const card = citationContent([e], open, post ?? undefined);
  document.body.append(card!.body);
  const buttons = (): HTMLButtonElement[] => [...card!.body.querySelectorAll<HTMLButtonElement>(".rd-cite-acts button, .rd-cite-fix button")];
  const button = (label: string): HTMLButtonElement | undefined => buttons().find((b) => b.textContent === label);
  return { card: card!, body: card!.body, open, post, buttons, button };
}

describe("citation card head", () => {
  it("tags a library paper REF and shows its venue, folder and citing command", () => {
    const { body } = render(entry);
    expect(body.querySelector(".rd-cite-tag")?.textContent).toBe("REF");
    expect(body.querySelector(".rd-cite-byline")?.textContent).toBe("A. Smith · 2020");
    expect(body.querySelector(".rd-cite-venue")?.textContent).toBe("NeurIPS · Thesis");
    expect(body.querySelector(".rd-cite-site")?.textContent).toBe("chapters/intro.tex:42 · \\cite[p.~3]{smith2020}");
  });

  it("tags a key only in the .bib file BIB and shows its record", () => {
    const { body, card } = render({ key: "doe19", bib: { title: "Plain Notes", authors: ["J. Doe"], year: 2019, venue: "arXiv" }, site: { ...site, line: 7 } });
    expect(body.querySelector(".rd-cite-tag")?.textContent).toBe("BIB");
    expect(body.querySelector(".rd-cite-title")?.textContent).toBe("Plain Notes");
    expect(body.querySelector(".rd-cite-venue")?.textContent).toBe("arXiv");
    expect(body.querySelector("[role=tablist]")).toBeNull();
    expect(card.copyText).toBe("doe19");
  });

  it("omits venue and site lines when the entry has none", () => {
    const { body } = render({ key: "k", paper: { id: "p", title: "T", authors: [] } }, jest.fn(), null);
    expect(body.querySelector(".rd-cite-venue")).toBeNull();
    expect(body.querySelector(".rd-cite-site")).toBeNull();
  });
});

describe("citation card highlights", () => {
  it("shows the cited page's highlights with a colour swatch and folds the rest", () => {
    const { body } = render(entry);
    const shown = [...body.querySelectorAll(".rd-cite-highlights > .rd-cite-list > li")];
    expect(shown.map((li) => li.querySelector(".rd-cite-quote")?.textContent)).toEqual(["Shelves bend.", "Books weigh."]);
    expect(shown.map((li) => li.className)).toEqual(["rd-cite-highlight rd-cite-hl-yellow", "rd-cite-highlight rd-cite-hl-green"]);
    const folded = body.querySelector<HTMLDetailsElement>(".rd-cite-highlights details")!;
    expect(folded.open).toBe(false);
    expect(folded.querySelector("summary")?.textContent).toBe("Other highlights (1)");
    expect(folded.querySelector(".rd-cite-quote")?.textContent).toBe("Wood warps.");
    expect(folded.querySelector(".rd-cite-page")?.textContent).toBe("p. 7");
  });

  it("says so when the cited page has no highlights", () => {
    const { body } = render({ ...entry, citedPage: 9 });
    expect(body.querySelector(".rd-cite-highlights > .rd-cite-empty")?.textContent).toBe("None on this page");
    expect(body.querySelectorAll(".rd-cite-highlights details li")).toHaveLength(3);
  });

  it("lists every highlight without folding when no page is cited", () => {
    const { body } = render(noPage);
    expect(body.querySelectorAll(".rd-cite-highlights > .rd-cite-list > li")).toHaveLength(3);
    expect(body.querySelector(".rd-cite-highlights details")).toBeNull();
  });
});

describe("citation card actions", () => {
  it("opens the paper at the cited page", () => {
    const { button, open } = render(entry);
    button("Open at p. 3")!.click();
    expect(open).toHaveBeenCalledWith("p1", 3);
  });

  it("offers a plain open when no page is cited", () => {
    const { button, open } = render(noPage);
    button("Open paper")!.click();
    expect(open).toHaveBeenCalledWith("p1");
  });

  it("goes to the citing source line", () => {
    const { button, post } = render(entry);
    button("Go to source")!.click();
    expect(post).toHaveBeenCalledWith({ command: "openSourceLine", file: "chapters/intro.tex", line: 42 });
  });

  it("has no Go to source without a citing command or a preview host", () => {
    expect(render(noSite).button("Go to source")).toBeUndefined();
    expect(render(entry, jest.fn(), null).button("Go to source")).toBeUndefined();
  });
});

describe("citation card fix row", () => {
  it("replaces the key at its \\cite", () => {
    const { button, post } = render({ key: "smth2020", site, fix: { kind: "replace", suggestion: "smith2020" } });
    button("Replace with smith2020")!.click();
    expect(post).toHaveBeenCalledWith({ command: "fixCitation", fix: { kind: "replace", key: "smth2020", replacement: "smith2020", file: "chapters/intro.tex", line: 42 } });
  });

  it("has no replace button without a citing command", () => {
    const { buttons } = render({ key: "smth2020", fix: { kind: "replace", suggestion: "smith2020" }, bib: { authors: [] } });
    expect(buttons().map((b) => b.textContent)).toEqual([]);
  });

  it("updates a preprint to its published venue", () => {
    const { button, post } = render({ ...entry, fix: { kind: "update", venue: "ICML 2021" } });
    button("Update to ICML 2021")!.click();
    expect(post).toHaveBeenCalledWith({ command: "fixCitation", fix: { kind: "update", key: "smith2020" } });
  });

  it("adds a .bib-only key to the library", () => {
    const { button, post } = render({ key: "doe19", bib: { authors: [] }, site, fix: { kind: "add" } });
    button("Add to library")!.click();
    expect(post).toHaveBeenCalledWith({ command: "fixCitation", fix: { kind: "add", key: "doe19" } });
  });

  it("shows no fix row for an entry without a fix", () => {
    expect(render(entry).body.querySelector(".rd-cite-fix")).toBeNull();
  });
});
