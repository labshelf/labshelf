// A sync request the background does not accept is logged with its reason and never fails the page.
const sendMessage = jest.fn();
jest.mock("webextension-polyfill", () => ({ runtime: { sendMessage: (m: unknown) => sendMessage(m) } }));

import type { ILogger } from "@labshelf/core";
import { scheduleSyncSoon } from "../../../src/library-page/host/runtimeRequests";

describe("scheduleSyncSoon", () => {
  const log = jest.fn(async () => undefined);
  const logger: ILogger = { log, error: jest.fn(async () => undefined) };
  beforeEach(() => { sendMessage.mockReset(); log.mockClear(); });

  it("logs the reason when the background refuses the request", async () => {
    sendMessage.mockResolvedValue({ ok: false, error: "sync unavailable" });
    scheduleSyncSoon(logger, "paper.status");
    await new Promise((resolve) => setImmediate(resolve));
    expect(log).toHaveBeenCalledWith("WARN", "library-page", "Sync request was not accepted", { reason: "paper.status", message: "sync unavailable" });
  });

  it("logs nothing when the request is accepted", async () => {
    sendMessage.mockResolvedValue({ ok: true });
    scheduleSyncSoon(logger, "paper.status");
    await new Promise((resolve) => setImmediate(resolve));
    expect(log).not.toHaveBeenCalled();
  });
});
