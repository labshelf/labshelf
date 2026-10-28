// Each entry reaches the console method of its level under a `[labshelf:<module>]` prefix.
// The log ring keeps entries in memory and in storage, and reports storage failures on the console instead of swallowing them.
import type { LogEntry } from "@labshelf/core";

const get = jest.fn<Promise<Record<string, unknown>>, [string]>();
const set = jest.fn<Promise<void>, [Record<string, unknown>]>();
jest.mock("webextension-polyfill", () => ({ storage: { local: { get: (k: string) => get(k), set: (v: Record<string, unknown>) => set(v) } } }));

import { ConsoleLogSink, StorageRingLogSink } from "../../src/platform/logging";

const levelled = (level: LogEntry["level"]): LogEntry => ({ timestamp: "t", level, module: "capture", message: "msg", context: { a: 1 } });
const entry = (message: string): LogEntry => ({ timestamp: "2026-01-01T00:00:00.000Z", level: "INFO", module: "test", message, context: {} });

describe("StorageRingLogSink", () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    get.mockReset().mockResolvedValue({});
    set.mockReset().mockResolvedValue(undefined);
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("appends after the stored entries and persists the ring", async () => {
    get.mockResolvedValue({ "labshelf.log.ring": [entry("older")] });
    const ring = new StorageRingLogSink();
    await ring.append(entry("newer"));
    expect((await ring.recent()).map((e) => e.message)).toEqual(["older", "newer"]);
    expect(set).toHaveBeenLastCalledWith({ "labshelf.log.ring": [entry("older"), entry("newer")] });
  });

  it("keeps only the latest 200 entries", async () => {
    const ring = new StorageRingLogSink();
    for (let i = 0; i < 205; i++) await ring.append(entry(`m${i}`));
    const recent = await ring.recent();
    expect(recent).toHaveLength(200);
    expect(recent[0]!.message).toBe("m5");
  });

  it("reports a ring that cannot be persisted on the console and keeps the entry in memory", async () => {
    set.mockRejectedValue(new Error("QUOTA_BYTES exceeded"));
    const ring = new StorageRingLogSink();
    await ring.append(entry("hello"));
    expect(warn).toHaveBeenCalledWith("[labshelf:logger] Could not persist the log ring", "QUOTA_BYTES exceeded");
    expect((await ring.recent()).map((e) => e.message)).toEqual(["hello"]);
  });

  it("reports a stored ring that cannot be read on the console and starts with an empty buffer", async () => {
    get.mockRejectedValue(new Error("storage unavailable"));
    const ring = new StorageRingLogSink();
    expect(await ring.recent()).toEqual([]);
    expect(warn).toHaveBeenCalledWith("[labshelf:logger] Could not read the stored log ring", "storage unavailable");
  });
});

describe("ConsoleLogSink", () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([["ERROR", "error"], ["WARN", "warn"], ["INFO", "info"]] as const)("writes %s through console.%s", async (level, method) => {
    const spy = jest.spyOn(console, method).mockImplementation(() => undefined);
    await new ConsoleLogSink().append(levelled(level));
    expect(spy).toHaveBeenCalledWith("[labshelf:capture]", "msg", { a: 1 });
  });
});
