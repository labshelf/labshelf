// Probing a tab merges the meta and link probes, and falls back to the URL alone when the tab cannot be probed.
// The probe module pulls in the platform polyfill, which needs a real extension runtime.
jest.mock("../../src/platform", () => ({ bx: {} }));

import { readPageAnchors, readPageMeta, readTabPage } from "../../src/capture/pageProbe";

const META = { pageUrl: "https://a.org/p", meta: { citation_title: ["T"] }, authorEmails: [{ email: "a@b.org", name: "A" }], documentTitle: "Title", pageIsPdf: true as const };
const LINKS = {
  pdfLinks: [{ url: "https://a.org/z.pdf", kind: "href" as const }, { url: "https://a.org/a.pdf", kind: "embed" as const }],
  doiLinks: ["https://doi.org/10.1/x"],
  mailtoLinks: [{ href: "mailto:a@b.org", text: "a@b.org", context: "ctx" }],
};
const URL_ = "https://a.org/tab";

type Answer = (func: unknown) => Promise<unknown>;
function install(answer: Answer): jest.Mock {
  const executeScript = jest.fn(({ func }: { func: unknown }) => answer(func));
  (globalThis as { chrome?: unknown }).chrome = { scripting: { executeScript } };
  return executeScript;
}
const healthy: Answer = async (func) => [{ result: func === readPageMeta ? META : LINKS }];
const logger = () => ({ log: jest.fn(async () => undefined), error: jest.fn() });

describe("readTabPage", () => {
  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
    delete (globalThis as { browser?: unknown }).browser;
  });

  it("merges both probe results and runs each probe once in the tab", async () => {
    const executeScript = install(healthy);
    const log = logger();
    expect(await readTabPage(log, 5, URL_)).toEqual({ ...META, ...LINKS });
    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 5 }, func: readPageMeta });
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 5 }, func: readPageAnchors });
    expect(log.log).not.toHaveBeenCalled();
  });

  it("passes the document title and PDF flag through and keeps link order", async () => {
    install(healthy);
    const page = await readTabPage(logger(), 5, URL_);
    expect(page.documentTitle).toBe("Title");
    expect(page.pageIsPdf).toBe(true);
    expect(page.pdfLinks.map((l) => l.url)).toEqual(["https://a.org/z.pdf", "https://a.org/a.pdf"]);
  });

  describe.each([["meta", readPageMeta], ["links", readPageAnchors]])("when the %s probe returns nothing", (_name, broken) => {
    it.each([["an empty array", []], ["an empty result", [{}]]])("falls back to the URL and logs a warning for %s", async (_label, reply) => {
      install(async (func) => (func === broken ? reply : [{ result: func === readPageMeta ? META : LINKS }]));
      const log = logger();
      expect(await readTabPage(log, 5, URL_)).toEqual({ pageUrl: URL_, meta: {}, pdfLinks: [], doiLinks: [], mailtoLinks: [], authorEmails: [] });
      expect(log.log).toHaveBeenCalledWith("WARN", "capture", "probe failed, using the URL alone", expect.objectContaining({ url: URL_ }));
    });
  });

  it("falls back and logs the error message when a probe rejects", async () => {
    install(async (func) => { if (func === readPageAnchors) throw new Error("tab closed"); return [{ result: META }]; });
    const log = logger();
    const page = await readTabPage(log, 5, URL_);
    expect(page.pageUrl).toBe(URL_);
    expect(page.pdfLinks).toEqual([]);
    expect(log.log).toHaveBeenCalledWith("WARN", "capture", "probe failed, using the URL alone", { url: URL_, error: "tab closed" });
  });

  it("falls back and logs when no scripting API exists", async () => {
    const log = logger();
    const page = await readTabPage(log, 5, URL_);
    expect(page.pageUrl).toBe(URL_);
    expect(log.log).toHaveBeenCalledWith("WARN", "capture", "probe failed, using the URL alone", expect.objectContaining({ url: URL_, error: expect.stringContaining("scripting") }));
  });

  describe("URL-only fallback", () => {
    beforeEach(() => { install(async () => []); });

    it.each(["https://a.org/x.pdf", "https://a.org/x.pdf?a=1", "https://a.org/x.PDF#p=2"])("marks %s as a PDF", async (url) => {
      expect((await readTabPage(logger(), 5, url)).pageIsPdf).toBe(true);
    });

    it.each(["https://a.org/x.pdfx", "https://a.org/pdf/page"])("does not mark %s as a PDF", async (url) => {
      expect(await readTabPage(logger(), 5, url)).not.toHaveProperty("pageIsPdf");
    });
  });
});
