// The watched access tab: one tab per paper, kept across service-worker restarts, attaching the PDF the user gets to.
const session: Record<string, unknown> = {};
const create = jest.fn();
const update = jest.fn();
const get = jest.fn();
jest.mock("../../src/platform", () => ({
  bx: {
    tabs: { create: (o: unknown) => create(o), update: (id: number, o: unknown) => update(id, o), get: (id: number) => get(id) },
    storage: { session: {
      get: async (key: string) => (key in session ? { [key]: JSON.parse(JSON.stringify(session[key])) } : {}),
      set: async (items: Record<string, unknown>) => { Object.assign(session, JSON.parse(JSON.stringify(items))); },
    } },
  },
}));
const fetchInTab = jest.fn();
jest.mock("../../src/capture/tab", () => ({ fetchInTab: (tabId: number, url: string) => fetchInTab(tabId, url) }));
const probeTab = jest.fn();
jest.mock("../../src/capture/tabProbe", () => ({ probeTab: (...args: unknown[]) => probeTab(...args) }));

import { onTabLoaded, openAccessTab, type AccessTabDeps } from "../../src/capture/watch";

const PDF = new TextEncoder().encode("%PDF-1.5 body");
const PAPER = { id: "p1", title: "Deep residual learning for image recognition" };
const ACCESS = { kind: "login" as const, url: "https://publisher.example/doi/pdf/10.1/x" };

function deps(): AccessTabDeps & { attach: jest.Mock } {
  return { log: { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) }, attach: jest.fn(async () => true) };
}

beforeEach(() => {
  for (const k of Object.keys(session)) delete session[k];
  jest.clearAllMocks();
  create.mockResolvedValue({ id: 5 });
  get.mockResolvedValue({ id: 5, status: "loading" });
});

describe("the watched access tab", () => {
  it("opens the page visibly and attaches the PDF the tab shows once the user gets through", async () => {
    const d = deps();
    await openAccessTab(d, PAPER, ACCESS);
    expect(create).toHaveBeenCalledWith({ url: ACCESS.url, active: true });
    fetchInTab.mockResolvedValue({ finalUrl: ACCESS.url, pdf: { bytes: PDF, url: ACCESS.url } });
    await onTabLoaded(d, 5, ACCESS.url);
    expect(d.attach).toHaveBeenCalledWith("p1", PDF);
    // Attached once: the watch is gone, so a later load in that tab is left alone.
    await onTabLoaded(d, 5, ACCESS.url);
    expect(d.attach).toHaveBeenCalledTimes(1);
  });

  it("checks a page that loaded before the watch was stored", async () => {
    get.mockResolvedValue({ id: 5, status: "complete", url: ACCESS.url });
    fetchInTab.mockResolvedValue({ finalUrl: ACCESS.url, pdf: { bytes: PDF, url: ACCESS.url } });
    const d = deps();
    await openAccessTab(d, PAPER, ACCESS);
    expect(d.attach).toHaveBeenCalledWith("p1", PDF);
  });

  it("brings back the tab already open for the paper instead of opening another", async () => {
    const d = deps();
    await openAccessTab(d, PAPER, ACCESS);
    update.mockResolvedValue({ id: 5 });
    await openAccessTab(d, PAPER, ACCESS);
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(5, { active: true });
  });

  it("downloads the PDF link of the article page the user reached, when the page is about the same paper", async () => {
    const d = deps();
    await openAccessTab(d, PAPER, ACCESS);
    const article = "https://publisher.example/doi/10.1/x";
    fetchInTab.mockImplementation(async (_: number, url: string) => url === article
      ? { finalUrl: article, html: "<html></html>" }
      : { finalUrl: url, pdf: { bytes: PDF, url } });
    probeTab.mockResolvedValue({ pageUrl: article, meta: { citation_title: [PAPER.title], citation_pdf_url: ["https://publisher.example/doi/pdf/10.1/x"] }, pdfLinks: [], doiLinks: [], mailtoLinks: [], authorEmails: [] });
    await onTabLoaded(d, 5, article);
    expect(d.attach).toHaveBeenCalledWith("p1", PDF);
  });

  it("takes nothing from a page about another work", async () => {
    const d = deps();
    await openAccessTab(d, PAPER, ACCESS);
    const other = "https://publisher.example/doi/10.1/other";
    fetchInTab.mockImplementation(async (_: number, url: string) => url === other
      ? { finalUrl: other, html: "<html></html>" }
      : { finalUrl: url, pdf: { bytes: PDF, url } });
    probeTab.mockResolvedValue({ pageUrl: other, meta: { citation_title: ["A survey of protein folding"], citation_pdf_url: ["https://publisher.example/doi/pdf/10.1/other"] }, pdfLinks: [], doiLinks: [], mailtoLinks: [], authorEmails: [] });
    await onTabLoaded(d, 5, other);
    expect(d.attach).not.toHaveBeenCalled();
  });

  it("stops watching after five minutes", async () => {
    const d = deps();
    const now = Date.now();
    await openAccessTab(d, PAPER, ACCESS);
    jest.spyOn(Date, "now").mockReturnValue(now + 5 * 60_000 + 1);
    fetchInTab.mockResolvedValue({ finalUrl: ACCESS.url, pdf: { bytes: PDF, url: ACCESS.url } });
    await onTabLoaded(d, 5, ACCESS.url);
    expect(d.attach).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it("ignores tabs it does not watch", async () => {
    const d = deps();
    await onTabLoaded(d, 99, ACCESS.url);
    expect(fetchInTab).not.toHaveBeenCalled();
  });
});
