// The log ring reports storage failures on the console instead of swallowing them.
const get = jest.fn<Promise<Record<string, unknown>>, [string]>();
const set = jest.fn<Promise<void>, [Record<string, unknown>]>();
jest.mock("webextension-polyfill", () => ({ storage: { local: { get: (k: string) => get(k), set: (v: Record<string, unknown>) => set(v) } } }));

describe("BrowserLogger storage failures", () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    jest.resetModules();
    get.mockReset().mockResolvedValue({});
    set.mockReset().mockResolvedValue(undefined);
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "info").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const loggerClass = (): typeof import("../../src/platform/logger").BrowserLogger => require("../../src/platform/logger").BrowserLogger;

  it("reports a ring that cannot be persisted on the console and keeps the entry in memory", async () => {
    set.mockRejectedValue(new Error("QUOTA_BYTES exceeded"));
    const logger = new (loggerClass())("test");
    await logger.info("hello");
    expect(warn).toHaveBeenCalledWith("[labshelf:logger] Could not persist the log ring", "QUOTA_BYTES exceeded");
    expect((await logger.recent()).map((e) => e.message)).toEqual(["hello"]);
  });

  it("reports a stored ring that cannot be read on the console and starts with an empty buffer", async () => {
    get.mockRejectedValue(new Error("storage unavailable"));
    const logger = new (loggerClass())("test");
    expect(await logger.recent()).toEqual([]);
    expect(warn).toHaveBeenCalledWith("[labshelf:logger] Could not read the stored log ring", "storage unavailable");
  });
});
