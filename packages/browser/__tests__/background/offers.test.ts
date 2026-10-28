// The PDF watcher: a downloaded or opened PDF that belongs to a paper without one becomes an offer badged on a tab; which downloads and addresses it looks at.
const session: Record<string, unknown> = {};
const action = { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn(), setTitle: jest.fn() };
const search = jest.fn();
const query = jest.fn();
jest.mock("../../src/platform", () => ({
  bx: {
    action: {
      setBadgeText: async (d: unknown) => action.setBadgeText(d),
      setBadgeBackgroundColor: async (d: unknown) => action.setBadgeBackgroundColor(d),
      setTitle: async (d: unknown) => action.setTitle(d),
    },
    downloads: { search: (q: unknown) => search(q) },
    tabs: { query: (q: unknown) => query(q) },
    storage: { session: {
      get: async (key: string) => (key in session ? { [key]: JSON.parse(JSON.stringify(session[key])) } : {}),
      set: async (items: Record<string, unknown>) => { Object.assign(session, JSON.parse(JSON.stringify(items))); },
    } },
  },
}));
const staged = new Map<string, Uint8Array>();
const records: unknown[] = [];
jest.mock("../../src/storage", () => ({
  listCachedPaperRecords: async () => records,
  writeStagedPdf: async (id: string, bytes: Uint8Array) => { staged.set(id, bytes); },
  removeStagedPdf: async (id: string) => { staged.delete(id); },
  removeStagedPdfsExcept: async () => undefined,
}));
const fetchPdf = jest.fn();
jest.mock("@labshelf/core", () => ({ ...jest.requireActual("@labshelf/core"), fetchPdf: (...a: unknown[]) => fetchPdf(...a) }));
const fetchInTab = jest.fn();
const watchOfTab = jest.fn();
const readFirstPageText = jest.fn();
jest.mock("../../src/capture/index", () => ({
  fetchInTab: (...a: unknown[]) => fetchInTab(...a),
  watchOfTab: (id: number) => watchOfTab(id),
  readFirstPageText: (...a: unknown[]) => readFirstPageText(...a),
}));

import { canRefetch, isPdfDownload, isPdfUrl, offerForTab, onDownloadChanged, onPdfTabLoaded } from "../../src/background/offers";

const PDF = new TextEncoder().encode("%PDF-1.7 body");
const log = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const science = { id: "p1", title: "Rapid evolution of coastal marine heatwave tolerance", path: "papers/doe2020", citeKey: "doe2020", status: "unread", doi: "10.1126/science.abc1234", hasPdf: false };
const other = { id: "p2", title: "A survey of graph neural network architectures", path: "papers/smith2021", citeKey: "smith2021", status: "unread", hasPdf: false };
const DOI_PDF = "https://www.science.org/doi/pdf/10.1126/science.abc1234";

function download(item: Record<string, unknown>): Promise<void> {
  search.mockResolvedValue([{ filename: "/Downloads/paper.pdf", mime: "application/pdf", ...item }]);
  return onDownloadChanged(log, { id: 1, state: { current: "complete" } });
}

beforeEach(() => {
  for (const k of Object.keys(session)) delete session[k];
  staged.clear();
  records.splice(0, records.length, science, other);
  jest.clearAllMocks();
  query.mockResolvedValue([{ id: 7 }]);
  fetchPdf.mockImplementation(async (url: string) => ({ bytes: PDF, url }));
  fetchInTab.mockResolvedValue(undefined);
  watchOfTab.mockResolvedValue(undefined);
});

describe("a finished download", () => {
  it("whose URL names a paper's DOI becomes an offer badged on the active tab", async () => {
    await download({ url: DOI_PDF });
    const offer = await offerForTab(7);
    expect(offer).toMatchObject({ source: "download", paperId: "p1", hasBytes: true, tabId: 7 });
    expect(staged.get(offer!.id)).toBe(PDF);
    expect(action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "PDF" });
    expect(fetchPdf).toHaveBeenCalledWith(DOI_PDF, expect.objectContaining({ credentials: "include" }));
  });

  it("is matched by the title on page 1 when its address names no paper", async () => {
    readFirstPageText.mockResolvedValue("Science\nA survey of graph neural\nnetwork architectures\nJane Doe");
    await download({ url: "https://cdn.example.com/files/8842.pdf" });
    expect(await offerForTab(7)).toMatchObject({ paperId: "p2", hasBytes: true });
  });

  it("of an unrelated PDF offers nothing and keeps no bytes", async () => {
    readFirstPageText.mockResolvedValue("Some other paper entirely\nAnother Author");
    await download({ url: "https://cdn.example.com/files/unrelated.pdf" });
    expect(await offerForTab(7)).toBeUndefined();
    expect(action.setBadgeText).not.toHaveBeenCalled();
    expect(staged.size).toBe(0);
  });

  it("does nothing, not even a fetch, when every paper has its PDF", async () => {
    records.splice(0, records.length, { ...science, hasPdf: true });
    await download({ url: DOI_PDF });
    expect(fetchPdf).not.toHaveBeenCalled();
    expect(await offerForTab(7)).toBeUndefined();
  });

  it("that cannot be fetched again still offers the id match, without bytes", async () => {
    fetchPdf.mockResolvedValue(undefined);
    await download({ url: "https://pdf.sciencedirectassets.com/one-time.pdf", referrer: "https://www.science.org/doi/10.1126/science.abc1234" });
    expect(await offerForTab(7)).toMatchObject({ paperId: "p1", hasBytes: false });
    expect(staged.size).toBe(0);
  });

  it("from a blob: address is matched by its referrer without a fetch", async () => {
    await download({ url: "blob:https://www.science.org/1234", referrer: "https://www.science.org/doi/10.1126/science.abc1234" });
    expect(fetchPdf).not.toHaveBeenCalled();
    expect(await offerForTab(7)).toMatchObject({ paperId: "p1", hasBytes: false });
  });

  it("that is not a PDF is ignored", async () => {
    await download({ url: "https://x.org/data.zip", filename: "/Downloads/data.zip", mime: "application/zip" });
    expect(fetchPdf).not.toHaveBeenCalled();
  });

  it("is looked at once per address", async () => {
    await download({ url: DOI_PDF });
    await download({ url: DOI_PDF });
    expect(fetchPdf).toHaveBeenCalledTimes(1);
  });
});

describe("a tab showing a PDF", () => {
  it("becomes an offer on that tab, fetched with the tab's own session first", async () => {
    fetchInTab.mockResolvedValue({ finalUrl: DOI_PDF, pdf: { bytes: PDF, url: DOI_PDF } });
    await onPdfTabLoaded(log, 3, DOI_PDF);
    expect(await offerForTab(3)).toMatchObject({ source: "tab", paperId: "p1", hasBytes: true });
    expect(fetchPdf).not.toHaveBeenCalled();
    expect(action.setBadgeText).toHaveBeenCalledWith({ tabId: 3, text: "PDF" });
  });

  it("is left to the access tab when LabShelf watches it for a sign-in", async () => {
    watchOfTab.mockResolvedValue({ tabId: 3, paperId: "p1", title: science.title, until: Date.now() + 1000 });
    await onPdfTabLoaded(log, 3, DOI_PDF);
    expect(fetchPdf).not.toHaveBeenCalled();
    expect(await offerForTab(3)).toBeUndefined();
  });

  it("drops its offer and badge when the tab moves on to another page", async () => {
    await onPdfTabLoaded(log, 3, DOI_PDF);
    const offer = await offerForTab(3);
    await onPdfTabLoaded(log, 3, "https://www.science.org/journal/science");
    expect(await offerForTab(3)).toBeUndefined();
    expect(staged.has(offer!.id)).toBe(false);
    expect(action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 3, text: null });
  });

  it("is not fetched when the page does not look like a PDF", async () => {
    await onPdfTabLoaded(log, 3, "https://www.science.org/doi/10.1126/science.abc1234");
    expect(fetchPdf).not.toHaveBeenCalled();
    expect(log.log).not.toHaveBeenCalled();
  });
});

// Which finished downloads and tab addresses the PDF watcher looks at, and which it may fetch again.
describe("the download filter", () => {
  it("takes a download served as a PDF, whatever its file name", () => {
    expect(isPdfDownload({ url: "https://x.org/get?id=1", filename: "/Downloads/get", mime: "application/pdf" })).toBe(true);
  });

  it("takes a file saved with a .pdf name", () => {
    expect(isPdfDownload({ url: "https://x.org/f", filename: "/Downloads/Paper.PDF", mime: "application/octet-stream" })).toBe(true);
  });

  it("leaves other downloads alone", () => {
    expect(isPdfDownload({ url: "https://x.org/data.zip", filename: "/Downloads/data.zip", mime: "application/zip" })).toBe(false);
  });

  it("fetches again only web addresses, never blob:, data: or file:", () => {
    expect(canRefetch("https://x.org/a.pdf")).toBe(true);
    expect(canRefetch("blob:https://x.org/1234-5678")).toBe(false);
    expect(canRefetch("data:application/pdf;base64,JVBERi0=")).toBe(false);
    expect(canRefetch("file:///Users/me/a.pdf")).toBe(false);
  });
});

describe("the PDF tab guess", () => {
  it.each([
    "https://arxiv.org/pdf/1706.03762v7",
    "https://www.science.org/doi/pdf/10.1126/science.abc1234",
    "https://onlinelibrary.wiley.com/doi/epdf/10.1002/x.1",
    "https://host.example/files/paper.pdf?download=1",
  ])("takes %s", (url) => expect(isPdfUrl(url)).toBe(true));

  it.each([
    "https://www.science.org/doi/10.1126/science.abc1234",
    "https://pdfs.example.com/about",
    "not a url",
  ])("skips %s", (url) => expect(isPdfUrl(url)).toBe(false));
});
