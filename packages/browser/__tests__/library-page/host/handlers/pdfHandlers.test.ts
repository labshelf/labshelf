/** The library page's Find PDF requests: a plain search and a search for a better version that replaces the file. */
const mockSendRuntime = jest.fn();
jest.mock("../../../../src/platform", () => ({ sendRuntime: (...a: unknown[]) => mockSendRuntime(...a) }));
jest.mock("../../../../src/capture", () => ({ attachPdfToPaper: jest.fn() }));
jest.mock("../../../../src/reader/access", () => ({ openReader: jest.fn() }));
jest.mock("../../../../src/storage", () => ({ IndexedDbFileSystem: class {} }));

import { createPdfHandlers } from "../../../../src/library-page/host/handlers/pdfHandlers";
import type { HostContext } from "../../../../src/library-page/host/hostContext";

function setup() {
  const posted: unknown[] = [];
  const notices: Array<[string, string]> = [];
  const ctx = {
    endpoint: { post: (m: unknown) => posted.push(m) },
    papers: (ids: string[]) => ids.map((id) => ({ id })),
    snapshots: { refresh: jest.fn(async () => undefined) },
    notice: (kind: string, text: string) => notices.push([kind, text]),
    log: { log: async () => undefined, error: async () => undefined },
  } as unknown as HostContext;
  return { handlers: createPdfHandlers(ctx), posted, notices, refresh: ctx.snapshots.refresh as jest.Mock };
}

beforeEach(() => mockSendRuntime.mockReset());

describe("find with replace", () => {
  it("sends replace to the background and reports the replaced PDF", async () => {
    mockSendRuntime.mockResolvedValue({ id: "p1", attached: true, replaced: true, source: "unpaywall" });
    const { handlers, notices, refresh } = setup();

    await handlers.find("p1", true);

    expect(mockSendRuntime).toHaveBeenCalledWith({ type: "paper.findPdf", id: "p1", replace: true });
    expect(refresh).toHaveBeenCalled();
    expect(notices[0]![0]).toBe("ok");
    expect(notices[0]![1]).toMatch(/^PDF replaced with a better version/);
  });

  it("shows the no-published-version notice on a miss instead of a find result", async () => {
    mockSendRuntime.mockResolvedValue({ id: "p1", attached: false, miss: { reason: "none" } });
    const { handlers, notices, posted } = setup();

    await handlers.find("p1", true);

    expect(notices).toEqual([["info", "No published version found. The PDF you have stays."]]);
    expect(posted.some((m) => (m as { type: string }).type === "pdf.findResult")).toBe(false);
  });
});

describe("find without replace", () => {
  it("sends a plain search", async () => {
    mockSendRuntime.mockResolvedValue({ id: "p1", attached: true, source: "arxiv" });
    const { handlers } = setup();

    await handlers.find("p1", false);

    expect(mockSendRuntime).toHaveBeenCalledWith({ type: "paper.findPdf", id: "p1" });
  });
});
