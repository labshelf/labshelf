// "Ask the author" in the background: finds an address, opens the request email and records the day.
import type { ILogger, PaperRecord, RawPage } from "@labshelf/core";

let mockRecords: PaperRecord[] = [];
const mockCreate = jest.fn(async () => undefined);
const mockUpdate = jest.fn(async () => undefined);
const mockBroadcast = jest.fn();

jest.mock("../../src/platform", () => ({
  bx: { tabs: { create: (...a: unknown[]) => (mockCreate as (...x: unknown[]) => unknown)(...a), update: (...a: unknown[]) => (mockUpdate as (...x: unknown[]) => unknown)(...a) } },
  readSettings: async () => ({ contactEmail: "me@uni.edu", requesterName: "Ada Requester", requesterAffiliation: "Uni", requestLanguage: "en" }),
}));
jest.mock("../../src/storage", () => ({ listCachedPaperRecords: async () => mockRecords }));
jest.mock("../../src/background/broadcast", () => ({ sendLibraryChanged: (...a: unknown[]) => mockBroadcast(...a) }));

import { sendCopyRequest, answerCopyRequest } from "../../src/background/copyRequest";

const log: ILogger = { log: async () => undefined, error: async () => undefined };
const setPdfRequestedAt = jest.fn(async () => undefined);
const deps = { log, mutations: { setPdfRequestedAt } as never };

const record = (over: Partial<PaperRecord> = {}): PaperRecord =>
  ({ id: "p1", title: "Deep Learning", citeKey: "p1", path: "papers/p1", status: "unread", authors: ["Ann Lee"], year: 2020, ...over });
const page = (email: string): RawPage => ({
  pageUrl: "https://journal.example/a", meta: {}, pdfLinks: [], doiLinks: [], mailtoLinks: [],
  authorEmails: [{ email, name: "Ann Lee" }],
});

const realFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  mockRecords = [];
  global.fetch = jest.fn(async () => ({ ok: false, status: 404, text: async () => "", json: async () => ({}) })) as never;
});
afterAll(() => { global.fetch = realFetch; });

describe("sendCopyRequest", () => {
  it("opens the mailto in the given tab and records today's day", async () => {
    const result = await sendCopyRequest(deps, record(), { tabId: 7, page: page("ann@uni.edu") });

    expect(result).toEqual({ id: "p1", opened: "mail" });
    expect(mockCreate).not.toHaveBeenCalled();
    const [tab, props] = mockUpdate.mock.calls[0] as unknown as [number, { url: string }];
    expect(tab).toBe(7);
    expect(props.url.startsWith("mailto:ann@uni.edu")).toBe(true);
    expect(decodeURIComponent(props.url)).toContain("Ada Requester");
    const [saved, day] = setPdfRequestedAt.mock.calls[0] as unknown as [PaperRecord, string];
    expect(saved.id).toBe("p1");
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mockBroadcast).toHaveBeenCalledWith("askAuthor", "p1");
  });

  it("opens the mailto in a new tab without a tab id", async () => {
    const result = await sendCopyRequest(deps, record(), { page: page("ann@uni.edu") });

    expect(result.opened).toBe("mail");
    expect(mockUpdate).not.toHaveBeenCalled();
    const arg = (mockCreate.mock.calls[0] as unknown as [{ url: string }])[0];
    expect(arg.url.startsWith("mailto:ann@uni.edu")).toBe(true);
  });

  it("opens the article page, and records nothing, when no address is found", async () => {
    const result = await sendCopyRequest(deps, record({ url: "https://journal.example/a" }), {});

    expect(result).toEqual({ id: "p1", opened: "article" });
    expect(mockCreate).toHaveBeenCalledWith({ url: "https://journal.example/a" });
    expect(setPdfRequestedAt).not.toHaveBeenCalled();
  });

  it("opens nothing when there is no address and no page to open", async () => {
    const result = await sendCopyRequest(deps, record(), {});

    expect(result).toEqual({ id: "p1", opened: "none" });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(setPdfRequestedAt).not.toHaveBeenCalled();
  });
});

describe("answerCopyRequest", () => {
  it("throws for a paper that is no longer in the library", async () => {
    await expect(answerCopyRequest(deps, "gone", 1)).rejects.toThrow("This paper is no longer in your library.");
  });

  it("looks the paper up and asks in the library's tab", async () => {
    mockRecords = [record({ url: "https://journal.example/a" })];
    const result = await answerCopyRequest(deps, "p1", 3);
    expect(result).toEqual({ id: "p1", opened: "article" });
  });
});
