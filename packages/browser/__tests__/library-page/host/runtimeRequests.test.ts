// A sync request the background does not accept is logged with its reason and never fails the page.
const sendMessage = jest.fn();
const warn = jest.fn(async () => undefined);
jest.mock("../../../src/platform", () => ({
  bx: { runtime: { sendMessage: (m: unknown) => sendMessage(m) } },
  BrowserLogger: class { warn = warn; },
}));

import { scheduleSyncSoon } from "../../../src/library-page/host/runtimeRequests";

describe("scheduleSyncSoon", () => {
  beforeEach(() => { sendMessage.mockReset(); warn.mockClear(); });

  it("logs the reason when the background refuses the request", async () => {
    sendMessage.mockResolvedValue({ ok: false, error: "sync unavailable" });
    scheduleSyncSoon("paper.status");
    await new Promise((resolve) => setImmediate(resolve));
    expect(warn).toHaveBeenCalledWith("Sync request was not accepted", { reason: "paper.status", message: "sync unavailable" });
  });

  it("logs nothing when the request is accepted", async () => {
    sendMessage.mockResolvedValue({ ok: true });
    scheduleSyncSoon("paper.status");
    await new Promise((resolve) => setImmediate(resolve));
    expect(warn).not.toHaveBeenCalled();
  });
});
