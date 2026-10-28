/** What the browser hands the core PDF search: the draft's record, the user's custom resolvers, cookies and the tab. */
import type { CustomResolver, Doi, ILogger, PdfFetchOptions, PdfSearch } from "@labshelf/core";

jest.mock("webextension-polyfill", () => ({ storage: { local: { get: async () => ({}), set: async () => undefined } } }));
jest.mock("../../src/storage/records", () => ({ ...jest.requireActual("../../src/storage/records"), listCachedPaperRecords: async () => [], writeCachedPaperRecord: async () => undefined }));

const mockSettings = {
  contactEmail: "me@uni.edu", customResolvers: [] as CustomResolver[],
  proxies: [{ name: "Uni library", template: ".ezproxy.uni.edu", enabled: true }],
};
jest.mock("../../src/platform/settings", () => ({ readSettings: async () => mockSettings, updateSettings: async () => undefined }));

const mockFindPaperPdf = jest.fn(async (_opts: PdfFetchOptions, _search: PdfSearch, _attempts: unknown[]) => undefined);
jest.mock("@labshelf/core", () => ({ ...jest.requireActual("@labshelf/core"), findPaperPdf: (...args: Parameters<typeof mockFindPaperPdf>) => mockFindPaperPdf(...args) }));

import { findPdf } from "../../src/capture/captureService";
import type { CaptureDraft } from "../../src/capture/captureService";

const log: ILogger = { log: async () => undefined, error: async () => undefined };

const draft = (over: Partial<CaptureDraft> = {}): CaptureDraft => ({
  pageUrl: "https://pub.example/article/1",
  ids: { doi: "10.1/x" as Doi },
  metadata: { title: "Attention is all you need", authors: ["Ashish Vaswani"], year: 2017 },
  origin: "registry",
  isPaper: true,
  pdfCandidates: [{ url: "https://pub.example/a.pdf", source: "page" }],
  fetchOpts: {},
  pdfAttempts: [],
  ...over,
});

beforeEach(() => {
  mockSettings.customResolvers = [];
  mockFindPaperPdf.mockClear();
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("findPdf", () => {
  it("gives the chain the draft's identifiers, record and page links, the user's contact and the draft's attempt list", async () => {
    const d = draft();
    await findPdf(log, d);
    expect(mockFindPaperPdf.mock.calls[0]![1]).toEqual({
      ids: { doi: "10.1/x" }, metadata: { title: "Attention is all you need", authors: ["Ashish Vaswani"], year: 2017 },
      landingUrl: "https://pub.example/article/1", pageCandidates: [{ url: "https://pub.example/a.pdf", source: "page" }],
      input: "https://pub.example/article/1", contactEmail: "me@uni.edu", customResolvers: [],
    });
    expect(mockFindPaperPdf.mock.calls[0]![2]).toBe(d.pdfAttempts);
  });

  it("hands the chain the user's custom resolvers as stored", async () => {
    mockSettings.customResolvers = [{ name: "Mirror", template: "https://host.example/find/{doi}", enabled: true }];
    await findPdf(log, draft());
    expect(mockFindPaperPdf.mock.calls[0]![1]).toMatchObject({ customResolvers: mockSettings.customResolvers });
  });

  it("downloads with the user's cookies, the tab's session and a helper tab for bot checks", async () => {
    const tab = { url: "https://pub.example/article/1", fetchInTab: async () => undefined };
    await findPdf(log, draft({ fetchOpts: { tab } }));
    expect(mockFindPaperPdf.mock.calls[0]![0]).toMatchObject({ credentials: "include", tab, viaHelperTab: expect.any(Function), logger: expect.anything() });
  });

  it("hands the search the user's library proxies", async () => {
    await findPdf(log, draft());
    expect(mockFindPaperPdf.mock.calls[0]![0]).toMatchObject({ proxies: mockSettings.proxies });
  });

  it("runs the search once per draft", async () => {
    const d = draft();
    await Promise.all([findPdf(log, d), findPdf(log, d)]);
    expect(mockFindPaperPdf).toHaveBeenCalledTimes(1);
  });
});
