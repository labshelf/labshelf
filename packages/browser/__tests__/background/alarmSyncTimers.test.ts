const alarms = {
  create: jest.fn(async () => undefined),
  clear: jest.fn(async () => true),
  listeners: [] as Array<(alarm: { name: string }) => void>,
};
jest.mock("webextension-polyfill", () => ({
  alarms: {
    create: (...args: unknown[]) => alarms.create(...(args as [])),
    clear: (...args: unknown[]) => alarms.clear(...(args as [])),
    onAlarm: { addListener: (fn: (alarm: { name: string }) => void) => alarms.listeners.push(fn) },
  },
}));

import type { ILogger } from "@labshelf/core";
import { AUTO_SYNC_ALARM, AlarmSyncTimers, DEBOUNCED_SYNC_ALARM } from "../../src/background/alarmSyncTimers";

const logger: ILogger = { log: async () => undefined, error: jest.fn(async () => undefined) };
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  alarms.create.mockClear();
  alarms.clear.mockClear();
  alarms.listeners.length = 0;
});

describe("AlarmSyncTimers", () => {
  it("arms the debounce as a one-shot alarm of at least 30 s", async () => {
    const timers = new AlarmSyncTimers(logger);
    timers.start("debounce", 30_000, false);
    timers.start("debounce", 1_000, false);
    await settle();
    expect(alarms.create).toHaveBeenNthCalledWith(1, DEBOUNCED_SYNC_ALARM, { delayInMinutes: 0.5 });
    expect(alarms.create).toHaveBeenNthCalledWith(2, DEBOUNCED_SYNC_ALARM, { delayInMinutes: 0.5 });
  });

  it("arms periodic syncs as a repeating alarm in whole minutes, at least one", async () => {
    const timers = new AlarmSyncTimers(logger);
    timers.start("periodic", 15 * 60_000, true);
    timers.start("periodic", 20_000, true);
    await settle();
    expect(alarms.create).toHaveBeenNthCalledWith(1, AUTO_SYNC_ALARM, { periodInMinutes: 15 });
    expect(alarms.create).toHaveBeenNthCalledWith(2, AUTO_SYNC_ALARM, { periodInMinutes: 1 });
  });

  it("runs a cancel before the start that follows it", async () => {
    const order: string[] = [];
    alarms.clear.mockImplementationOnce(async () => { await settle(); order.push("clear"); return true; });
    alarms.create.mockImplementationOnce(async () => { order.push("create"); });
    const timers = new AlarmSyncTimers(logger);
    timers.cancel("periodic");
    timers.start("periodic", 60_000, true);
    await settle();
    await settle();
    expect(order).toEqual(["clear", "create"]);
  });

  it("forwards only its own alarms to the coordinator", () => {
    const fired: string[] = [];
    new AlarmSyncTimers(logger).listen((id) => fired.push(id));
    for (const name of [DEBOUNCED_SYNC_ALARM, "labshelf.other", AUTO_SYNC_ALARM]) alarms.listeners.forEach((fn) => fn({ name }));
    expect(fired).toEqual(["debounce", "periodic"]);
  });

  it("logs an alarm call that fails and keeps going", async () => {
    alarms.clear.mockRejectedValueOnce(new Error("no alarms permission"));
    const timers = new AlarmSyncTimers(logger);
    timers.cancel("debounce");
    timers.start("debounce", 30_000, false);
    await settle();
    expect(logger.error).toHaveBeenCalledWith("background/alarms", expect.any(Error), { alarm: DEBOUNCED_SYNC_ALARM });
    expect(alarms.create).toHaveBeenCalledTimes(1);
  });
});
