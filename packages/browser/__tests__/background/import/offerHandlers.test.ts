// The popup's pdfOffer.* messages: what the popup is shown, and what attaching or dismissing an offer leaves behind.
const session: Record<string, unknown> = {};
const setBadgeText = jest.fn();
jest.mock("../../../src/platform", () => ({
  bx: {
    action: { setBadgeText: async (d: unknown) => setBadgeText(d), setBadgeBackgroundColor: async () => undefined, setTitle: async () => undefined },
    storage: { session: {
      get: async (key: string) => (key in session ? { [key]: JSON.parse(JSON.stringify(session[key])) } : {}),
      set: async (items: Record<string, unknown>) => { Object.assign(session, JSON.parse(JSON.stringify(items))); },
    } },
  },
}));
const staged = new Map<string, Uint8Array>();
const records: Array<Record<string, unknown>> = [];
jest.mock("../../../src/storage", () => ({
  listCachedPaperRecords: async () => records,
  readStagedPdf: async (id: string) => staged.get(id),
  removeStagedPdf: async (id: string) => { staged.delete(id); },
}));
const attachPdfToPaper = jest.fn();
jest.mock("../../../src/capture/index", () => ({ attachPdfToPaper: (...a: unknown[]) => attachPdfToPaper(...a) }));
const broadcastChanged = jest.fn();
jest.mock("../../../src/background/broadcast", () => ({ sendLibraryChanged: (...a: unknown[]) => broadcastChanged(...a) }));

import { answerPdfOfferMessage } from "../../../src/background/import";
import { readOffer, writeOffer, type PdfOffer } from "../../../src/background/import/offerStore";

const PDF = new TextEncoder().encode("%PDF-1.7 body");
const log = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const mutations = {} as never;
const send = (msg: Parameters<typeof answerPdfOfferMessage>[1]) => answerPdfOfferMessage({ log, mutations }, msg);
const paper = { id: "p1", title: "Attention is all you need", path: "papers/ml/vaswani2017", hasPdf: false };
const offer: PdfOffer = {
  id: "o1", source: "tab", tabId: 4, url: "https://arxiv.org/pdf/1706.03762", paperId: "p1", title: paper.title,
  version: "preprint", hasBytes: true, at: Date.now(),
};

beforeEach(async () => {
  for (const k of Object.keys(session)) delete session[k];
  jest.clearAllMocks();
  records.splice(0, records.length, { ...paper });
  staged.clear();
  staged.set("o1", PDF);
  await writeOffer(offer);
  attachPdfToPaper.mockResolvedValue({ record: paper, written: true });
});

describe("pdfOffer.get", () => {
  it("shows the offer with the paper's folder", async () => {
    expect(await send({ type: "pdfOffer.get", tabId: 4 })).toEqual({
      id: "o1", paperId: "p1", title: paper.title, folder: "papers/ml", hasBytes: true, source: "tab", onThisTab: true,
    });
  });

  it("drops an offer whose paper got its PDF meanwhile, and its badge", async () => {
    records[0]!["hasPdf"] = true;
    expect(await send({ type: "pdfOffer.get", tabId: 4 })).toBeNull();
    expect(await readOffer("o1")).toBeUndefined();
    expect(staged.has("o1")).toBe(false);
    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 4, text: null });
  });
});

describe("pdfOffer.attach", () => {
  it("writes paper.pdf through attachPdfToPaper, then clears the badge and the staged bytes", async () => {
    const r = await send({ type: "pdfOffer.attach", offerId: "o1" });
    expect(attachPdfToPaper).toHaveBeenCalledWith(mutations, "p1", PDF, { version: "preprint" });
    expect(r).toEqual({ id: "p1", attached: true });
    expect(staged.has("o1")).toBe(false);
    expect(await readOffer("o1")).toBeUndefined();
    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 4, text: null });
    expect(broadcastChanged).toHaveBeenCalledWith("attach", "p1", expect.any(String));
  });

  it("refuses an offer without bytes, which the popup sends to the library instead", async () => {
    await writeOffer({ ...offer, hasBytes: false });
    await expect(send({ type: "pdfOffer.attach", offerId: "o1" })).rejects.toThrow(/could not download/);
    expect(attachPdfToPaper).not.toHaveBeenCalled();
  });
});

describe("pdfOffer.dismiss", () => {
  it("drops the offer, its bytes and its badge", async () => {
    await send({ type: "pdfOffer.dismiss", offerId: "o1" });
    expect(await readOffer("o1")).toBeUndefined();
    expect(staged.has("o1")).toBe(false);
    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 4, text: null });
  });
});
