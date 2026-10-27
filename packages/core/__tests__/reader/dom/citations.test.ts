/** @jest-environment jsdom */
// Tests citations in a build preview: the lookup client, link clicks and hover cards, page areas and the citation card.
import {
  attachCitationClicks, PreviewCitations, deriveRectArea, deriveScreenArea, CitationFinder, LOOKUP_TIMEOUT_MS,
  renderCitationContent, OPEN_PAPER_LABEL,
} from "../../../src/reader/dom/citations";
import type { ReaderContext } from "../../../src/reader/dom/readerSession";
import { DOCUMENT_REPLACED } from "../../../src/reader/dom/pdfLoader";
import type { CitationEntry, CitationQuery } from "../../../src/reader/index";
import type { PageViewportLike } from "../../../src/reader/dom/navigation";

const HEIGHT = 842;
const clickedPaper: CitationEntry = { key: "smith2020", paper: { id: "p1", title: "Deep Shelves", authors: ["A. Smith"], year: 2020 } };

function setupClicks(options: { preview?: boolean; answer?: CitationEntry[] } = {}) {
  const { preview = true, answer = [clickedPaper] } = options;
  document.body.innerHTML = `<div id="viewer"><div class="page" data-page-number="2">
    <section class="linkAnnotation" data-internal-link data-annotation-id="12R"><a href="#cite" id="link"></a></section></div></div>`;
  const viewer = document.getElementById("viewer") as HTMLElement;
  const link = viewer.querySelector("section") as HTMLElement;
  const navigated = jest.fn(() => false);
  (document.getElementById("link") as HTMLAnchorElement).onclick = navigated;
  const posted: unknown[] = [];
  const view = { viewport: { viewBox: [0, 0, 595, HEIGHT], convertToPdfPoint: () => [0, 0], convertToViewportPoint: () => [0, 0] } };
  let citations: PreviewCitations;
  const ctx = {
    boot: { preview },
    host: {
      post: (msg: { command: string; request?: number }) => {
        posted.push(msg);
        if (msg.command === "lookupCitation") { queueMicrotask(() => citations.lookup.receive(msg.request as number, answer)); }
      },
    },
    pdfDocument: { getPage: async () => ({ getAnnotations: async () => [{ id: "12R", subtype: "Link", dest: "cite.smith2020", rect: [100, 700, 150, 712] }] }) },
    pdfViewer: { getPageView: () => view },
    eventBus: { on: jest.fn() },
  } as unknown as ReaderContext;
  citations = new PreviewCitations(ctx);
  attachCitationClicks(viewer, ctx, citations);
  const click = async () => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.getElementById("link")!.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return event;
  };
  return { citations, link, posted, navigated, click, lookups: () => posted.filter((m) => (m as { command: string }).command === "lookupCitation") };
}

describe("a preview's citation links", () => {
  it("asks about the link with its top-left area and named destination", async () => {
    const { citations, link, lookups } = setupClicks();
    await citations.linkEntries(link);
    expect(lookups()).toEqual([{
      command: "lookupCitation",
      request: 1,
      query: { area: { page: 2, left: 100, right: 150, top: 130, bottom: 142 }, link: true, dest: "cite.smith2020" },
    }]);
  });

  it("builds a card from the answer", async () => {
    const { citations, link } = setupClicks();
    const card = await citations.linkCard(link);
    expect(card?.title).toBe("Cited paper");
  });

  it("opens the cited paper on click and does not follow the link", async () => {
    const { posted, navigated, click } = setupClicks();
    const event = await click();
    expect(posted).toContainEqual({ command: "openCitedPaper", paperId: "p1" });
    expect(navigated).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("follows a link whose key has no library paper", async () => {
    const { posted, navigated, click } = setupClicks({ answer: [{ key: "ghost1999" }] });
    await click();
    expect(navigated).toHaveBeenCalledTimes(1);
    expect(posted.some((m) => (m as { command: string }).command === "openCitedPaper")).toBe(false);
  });

  it("answers a repeated click from the cache", async () => {
    const { click, lookups } = setupClicks();
    await click();
    await click();
    expect(lookups()).toHaveLength(1);
  });
});

describe("a library reader", () => {
  it("never asks the host about citations and leaves clicks to pdf.js", async () => {
    const { citations, link, posted, navigated, click } = setupClicks({ preview: false });
    expect(await citations.linkEntries(link)).toEqual([]);
    expect(await citations.linkCard(link)).toBeNull();
    await click();
    expect(posted).toEqual([]);
    expect(navigated).toHaveBeenCalledTimes(1);
  });
});

const viewport: PageViewportLike = {
  viewBox: [0, 0, 595, HEIGHT],
  convertToPdfPoint: (x, y) => [x, HEIGHT - y],
  convertToViewportPoint: (x, y) => [x, HEIGHT - y],
};

describe("deriveRectArea", () => {
  it("flips a bottom-left rectangle to a top-left area", () => {
    expect(deriveRectArea(3, [100, 700, 150, 712], [0, 0, 595, HEIGHT])).toEqual({ page: 3, left: 100, right: 150, top: 130, bottom: 142 });
  });

  it("measures from the view box origin and orders swapped corners", () => {
    expect(deriveRectArea(1, [150, 712, 100, 700], [10, 20, 605, 862])).toEqual({ page: 1, left: 90, right: 140, top: 150, bottom: 162 });
  });
});

describe("deriveScreenArea", () => {
  it("converts a client rectangle over a page", () => {
    const pageEl = document.createElement("div");
    pageEl.getBoundingClientRect = () => ({ left: 20, top: 300 }) as DOMRect;
    const rect = { left: 120, top: 350, right: 170, bottom: 362 } as DOMRect;
    expect(deriveScreenArea(2, viewport, pageEl, rect)).toEqual({ page: 2, left: 100, right: 150, top: 50, bottom: 62 });
  });
});

const query: CitationQuery = { area: { page: 1, left: 0, top: 0, right: 1, bottom: 1 }, link: true };
const entry: CitationEntry = { key: "smith2020" };

function setupLookup() {
  const handlers = new Map<string, () => void>();
  const post = jest.fn();
  const ctx = { host: { post }, eventBus: { on: (name: string, fn: () => void) => handlers.set(name, fn) } } as unknown as ReaderContext;
  return { lookup: new CitationFinder(ctx), post, handlers, requests: () => post.mock.calls.map((c) => (c[0] as { request: number }).request) };
}

describe("CitationFinder", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("resolves each request with the answer carrying its number", async () => {
    const { lookup, post, requests } = setupLookup();
    const first = lookup.lookup(query);
    const second = lookup.lookup({ ...query, link: false });
    expect(post).toHaveBeenCalledWith({ command: "lookupCitation", request: 1, query });
    expect(requests()).toEqual([1, 2]);
    lookup.receive(2, [{ key: "b" }]);
    lookup.receive(1, [entry]);
    await expect(first).resolves.toEqual([entry]);
    await expect(second).resolves.toEqual([{ key: "b" }]);
  });

  it("resolves empty when the host does not answer in time and ignores a late answer", async () => {
    const { lookup } = setupLookup();
    const asked = lookup.lookup(query);
    jest.advanceTimersByTime(LOOKUP_TIMEOUT_MS);
    await expect(asked).resolves.toEqual([]);
    expect(() => lookup.receive(1, [entry])).not.toThrow();
  });

  it("answers a cached place without asking again, and asks again after a timeout", async () => {
    const { lookup, post } = setupLookup();
    const first = lookup.lookup(query, "1:12R");
    lookup.receive(1, [entry]);
    await first;
    await expect(lookup.lookup(query, "1:12R")).resolves.toEqual([entry]);
    expect(post).toHaveBeenCalledTimes(1);

    const silent = lookup.lookup(query, "1:99R");
    jest.advanceTimersByTime(LOOKUP_TIMEOUT_MS);
    await silent;
    void lookup.lookup(query, "1:99R");
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("forgets cached places when the document is replaced", async () => {
    const { lookup, post, handlers } = setupLookup();
    const first = lookup.lookup(query, "1:12R");
    lookup.receive(1, [entry]);
    await first;
    handlers.get(DOCUMENT_REPLACED)?.();
    void lookup.lookup(query, "1:12R");
    expect(post).toHaveBeenCalledTimes(2);
  });
});

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

const site = { file: "chapters/intro.tex", line: 42, text: "\\cite[p.~3]{smith2020}" };
const previewPaper: NonNullable<CitationEntry["paper"]> = {
  id: "p1", title: "Deep Shelves", authors: ["A. Smith"], year: 2020, venue: "NeurIPS", folder: "Thesis",
  highlights: [
    { text: "Shelves bend.", page: 3, color: "yellow" },
    { text: "Books weigh.", page: 3, color: "green" },
    { text: "Wood warps.", page: 7, color: "blue" },
  ],
};
const previewEntry: CitationEntry = { key: "smith2020", paper: previewPaper, site, citedPage: 3 };
const noPage: CitationEntry = { key: "smith2020", paper: previewPaper, site };
const noSite: CitationEntry = { key: "smith2020", paper: previewPaper, citedPage: 3 };

function render(e: CitationEntry, open = jest.fn(), post = jest.fn()) {
  document.body.innerHTML = "";
  const card = renderCitationContent([e], open, post);
  document.body.append(card!.body);
  const buttons = (): HTMLButtonElement[] => [...card!.body.querySelectorAll<HTMLButtonElement>(".rd-cite-acts button, .rd-cite-fix button")];
  const button = (label: string): HTMLButtonElement | undefined => buttons().find((b) => b.textContent === label);
  return { card: card!, body: card!.body, open, post, buttons, button };
}

describe("citation card head", () => {
  it("tags a library paper REF and shows its venue, folder and citing command", () => {
    const { body } = render(previewEntry);
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
    expect(card.copyText).toBe("doe19");
  });

  it("omits venue and site lines when the entry has none", () => {
    const { body } = render({ key: "k", paper: { id: "p", title: "T", authors: [] } });
    expect(body.querySelector(".rd-cite-venue")).toBeNull();
    expect(body.querySelector(".rd-cite-site")).toBeNull();
  });
});

describe("citation card highlights", () => {
  it("shows the cited page's highlights with a colour swatch and folds the rest", () => {
    const { body } = render(previewEntry);
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
    const { body } = render({ ...previewEntry, citedPage: 9 });
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
    const { button, open } = render(previewEntry);
    button("Open at p. 3")!.click();
    expect(open).toHaveBeenCalledWith("p1", 3);
  });

  it("offers a plain open when no page is cited", () => {
    const { button, open } = render(noPage);
    button("Open paper")!.click();
    expect(open).toHaveBeenCalledWith("p1");
  });

  it("goes to the citing source line", () => {
    const { button, post } = render(previewEntry);
    button("Go to source")!.click();
    expect(post).toHaveBeenCalledWith({ command: "openSourceLine", file: "chapters/intro.tex", line: 42 });
  });

  it("has no Go to source without a citing command", () => {
    expect(render(noSite).button("Go to source")).toBeUndefined();
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
    const { button, post } = render({ ...previewEntry, fix: { kind: "update", venue: "ICML 2021" } });
    button("Update to ICML 2021")!.click();
    expect(post).toHaveBeenCalledWith({ command: "fixCitation", fix: { kind: "update", key: "smith2020" } });
  });

  it("adds a .bib-only key to the library", () => {
    const { button, post } = render({ key: "doe19", bib: { authors: [] }, site, fix: { kind: "add" } });
    button("Add to library")!.click();
    expect(post).toHaveBeenCalledWith({ command: "fixCitation", fix: { kind: "add", key: "doe19" } });
  });

  it("shows no fix row for an entry without a fix", () => {
    expect(render(previewEntry).body.querySelector(".rd-cite-fix")).toBeNull();
  });
});
