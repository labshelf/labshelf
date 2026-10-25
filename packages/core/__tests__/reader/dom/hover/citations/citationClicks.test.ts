/**
 * @jest-environment jsdom
 */
// Tests how a build preview treats links: hover cards and clicks use the host's citation answers, a library reader asks nothing.
import { attachCitationClicks, PreviewCitations } from "../../../../../src/reader/dom/hover/citations";
import type { ReaderContext } from "../../../../../src/reader/dom/session";
import type { CitationEntry } from "../../../../../src/reader";

const HEIGHT = 842;
const paper: CitationEntry = { key: "smith2020", paper: { id: "p1", title: "Deep Shelves", authors: ["A. Smith"], year: 2020 } };

function setup(options: { preview?: boolean; answer?: CitationEntry[] } = {}) {
  const { preview = true, answer = [paper] } = options;
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
    const { citations, link, lookups } = setup();
    await citations.linkEntries(link);
    expect(lookups()).toEqual([{
      command: "lookupCitation",
      request: 1,
      query: { area: { page: 2, left: 100, right: 150, top: 130, bottom: 142 }, link: true, dest: "cite.smith2020" },
    }]);
  });

  it("builds a card from the answer", async () => {
    const { citations, link } = setup();
    const card = await citations.linkCard(link);
    expect(card?.title).toBe("Cited paper");
  });

  it("opens the cited paper on click and does not follow the link", async () => {
    const { posted, navigated, click } = setup();
    const event = await click();
    expect(posted).toContainEqual({ command: "openCitedPaper", paperId: "p1" });
    expect(navigated).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("follows a link whose key has no library paper", async () => {
    const { posted, navigated, click } = setup({ answer: [{ key: "ghost1999" }] });
    await click();
    expect(navigated).toHaveBeenCalledTimes(1);
    expect(posted.some((m) => (m as { command: string }).command === "openCitedPaper")).toBe(false);
  });

  it("answers a repeated click from the cache", async () => {
    const { click, lookups } = setup();
    await click();
    await click();
    expect(lookups()).toHaveLength(1);
  });
});

describe("a library reader", () => {
  it("never asks the host about citations and leaves clicks to pdf.js", async () => {
    const { citations, link, posted, navigated, click } = setup({ preview: false });
    expect(await citations.linkEntries(link)).toEqual([]);
    expect(await citations.linkCard(link)).toBeNull();
    await click();
    expect(posted).toEqual([]);
    expect(navigated).toHaveBeenCalledTimes(1);
  });
});
