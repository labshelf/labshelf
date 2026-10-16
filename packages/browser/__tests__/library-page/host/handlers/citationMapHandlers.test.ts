/** The library page's citation map: opening posts loading then the map naming only the papers it mentions, and import reports back to the UI. */
const mockSendRuntime = jest.fn();
jest.mock("../../../../src/platform", () => ({ sendRuntime: (...a: unknown[]) => mockSendRuntime(...a) }));

import { createCitationMapHandlers } from "../../../../src/library-page/host/handlers/citationMapHandlers";
import type { HostContext } from "../../../../src/library-page/host/hostContext";

const TITLES: Record<string, string> = { a: "Alpha", b: "Beta", c: "Gamma", z: "Unmentioned" };

function setup() {
  const posted: unknown[] = [];
  const notices: Array<[string, string]> = [];
  const error = jest.fn(async () => undefined);
  const ctx = {
    endpoint: { post: (m: unknown) => posted.push(m) },
    snapshots: {
      refresh: jest.fn(async () => undefined),
      current: () => ({ papers: Object.entries(TITLES).map(([id, title]) => ({ id, title, path: `papers/${id}` })) }),
    },
    notice: (kind: string, text: string) => notices.push([kind, text]),
    log: { log: async () => undefined, error },
  } as unknown as HostContext;
  return { handlers: createCitationMapHandlers(ctx), posted, notices, error, refresh: ctx.snapshots.refresh as jest.Mock };
}

beforeEach(() => mockSendRuntime.mockReset());

describe("open", () => {
  it("posts loading, then the map with only the papers a link or a missing work's citedBy mentions", async () => {
    const missing = [{ workId: "W9", title: "Missing", citedBy: ["b", "c"] }];
    mockSendRuntime.mockResolvedValue({ links: [{ from: "a", to: "b" }], missing, unresolved: [] });
    const { handlers, posted } = setup();

    await handlers.open();

    expect(mockSendRuntime).toHaveBeenCalledWith({ type: "citationMap.build" });
    expect(posted).toEqual([
      { type: "citationMap.show", state: { status: "loading" } },
      {
        type: "citationMap.show",
        state: { status: "ready", map: {
          papers: [{ id: "a", title: "Alpha" }, { id: "b", title: "Beta" }, { id: "c", title: "Gamma" }],
          links: [{ from: "a", to: "b" }], missing,
        } },
      },
    ]);
  });

  it("logs a failed build and posts the failure", async () => {
    mockSendRuntime.mockRejectedValue(new Error("OpenAlex is down"));
    const { handlers, posted, error } = setup();

    await handlers.open();

    expect(posted[1]).toEqual({ type: "citationMap.show", state: { status: "failed", message: "OpenAlex is down" } });
    expect(error).toHaveBeenCalledWith("library-page", expect.any(Error), { op: "citationMap.build" });
  });
});

describe("importWork", () => {
  it("imports by DOI, refreshes the library and tells the UI", async () => {
    mockSendRuntime.mockResolvedValue({ status: "saved", id: "p9", title: "Missing" });
    const { handlers, posted, notices, refresh } = setup();

    await handlers.importWork("W9", "10.1/m");

    expect(mockSendRuntime).toHaveBeenCalledWith({ type: "citationMap.importDoi", doi: "10.1/m" });
    expect(refresh).toHaveBeenCalled();
    expect(notices).toEqual([["ok", 'Imported "Missing"']]);
    expect(posted).toEqual([{ type: "citationMap.imported", workId: "W9" }]);
  });

  it("counts a paper the library already holds as imported and says so", async () => {
    mockSendRuntime.mockResolvedValue({ status: "already-present", id: "p1", title: "Held" });
    const { handlers, posted, notices } = setup();

    await handlers.importWork("W1", "10.1/h");

    expect(notices).toEqual([["ok", '"Held" is already in your library']]);
    expect(posted).toEqual([{ type: "citationMap.imported", workId: "W1" }]);
  });

  it("logs a failure, shows an error notice and clears the busy button", async () => {
    mockSendRuntime.mockRejectedValue(new Error("No registry knows it"));
    const { handlers, posted, notices, error, refresh } = setup();

    await handlers.importWork("W2", "10.1/x");

    expect(notices).toEqual([["error", "No registry knows it"]]);
    expect(posted).toEqual([{ type: "citationMap.importFailed", workId: "W2" }]);
    expect(error).toHaveBeenCalledWith("library-page", expect.any(Error), { op: "citationMap.import", workId: "W2", doi: "10.1/x" });
    expect(refresh).not.toHaveBeenCalled();
  });
});
