import { LibraryRootPresenceMonitor, type ILogger } from "@labshelf/core";

const logger = { log: jest.fn(async () => undefined) } as unknown as ILogger;

beforeEach(() => { jest.useFakeTimers(); (logger.log as jest.Mock).mockClear(); });
afterEach(() => { jest.useRealTimers(); });

function monitor(state: { present: boolean }) {
  const events: string[] = [];
  const m = new LibraryRootPresenceMonitor({
    exists: async () => state.present,
    onLost: () => events.push("lost"),
    onReturned: () => events.push("returned"),
    logger,
    intervalMs: 1000,
  });
  return { m, events };
}

describe("RootPresenceMonitor", () => {
  it("reports loss once and the return once, polling while the root is gone", async () => {
    const state = { present: true };
    const { m, events } = monitor(state);
    m.start();
    await jest.advanceTimersByTimeAsync(3000);
    expect(events).toEqual([]);
    state.present = false;
    await jest.advanceTimersByTimeAsync(3000);
    expect(events).toEqual(["lost"]);
    state.present = true;
    await jest.advanceTimersByTimeAsync(1000);
    expect(events).toEqual(["lost", "returned"]);
    expect((logger.log as jest.Mock).mock.calls.map((c) => c[0])).toEqual(["WARN", "INFO"]);
    m.stop();
  });

  it("check() sees a loss between polls and returns whether the root is present", async () => {
    const state = { present: true };
    const { m, events } = monitor(state);
    m.start();
    state.present = false;
    expect(await m.check()).toBe(false);
    expect(events).toEqual(["lost"]);
    m.stop();
  });

  it("stops polling after stop()", async () => {
    const state = { present: true };
    const { m, events } = monitor(state);
    m.start();
    m.stop();
    state.present = false;
    await jest.advanceTimersByTimeAsync(5000);
    expect(events).toEqual([]);
  });
});
