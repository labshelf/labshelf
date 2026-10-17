import { promises as fs, watch } from "node:fs";

import type { ILogger } from "@labshelf/core";

import { LibraryWatcher } from "../../src/library/libraryWatcher";
import { LibraryRoot } from "../../src/library/libraryRoot";

jest.mock("node:fs", () => ({ watch: jest.fn(), promises: { stat: jest.fn() } }));

type Listener = (event: string, file: string | Buffer | null) => void;
const listeners: Listener[] = [];
const closers: jest.Mock[] = [];
const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;
const stat = fs.stat as unknown as jest.Mock;

beforeEach(() => {
  listeners.length = 0;
  closers.length = 0;
  stat.mockReset().mockResolvedValue({});
  jest.useFakeTimers();
  (watch as jest.Mock).mockImplementation((_dir: string, _opts: unknown, listener: Listener) => {
    listeners.push(listener);
    const close = jest.fn();
    closers.push(close);
    return { on: jest.fn(), close };
  });
});

afterEach(() => {
  jest.useRealTimers();
});

function enoent(): Error {
  return Object.assign(new Error("gone"), { code: "ENOENT" });
}

describe("LibraryWatcher", () => {
  it("ignores noise, counts a null filename as a change and debounces", () => {
    const onChange = jest.fn();
    const watcher = new LibraryWatcher(new LibraryRoot("/lib"), onChange, logger, jest.fn());
    watcher.start();
    expect(listeners).toHaveLength(3);

    listeners[0]!("change", ".metadata.yaml.1.tmp");
    listeners[0]!("change", "p/a~");
    listeners[0]!("change", "p/a.swp");
    jest.advanceTimersByTime(300);
    expect(onChange).not.toHaveBeenCalled();

    listeners[0]!("change", null);
    listeners[0]!("change", "p/metadata.yaml");
    jest.advanceTimersByTime(249);
    expect(onChange).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it("closes the watchers and reports a lost root once", async () => {
    const onRootLost = jest.fn();
    const watcher = new LibraryWatcher(new LibraryRoot("/lib"), jest.fn(), logger, onRootLost);
    watcher.start();
    stat.mockRejectedValue(enoent());

    await jest.advanceTimersByTimeAsync(5_000);
    await jest.advanceTimersByTimeAsync(5_000);

    expect(onRootLost).toHaveBeenCalledTimes(1);
    expect(closers.every((close) => close.mock.calls.length === 1)).toBe(true);
    watcher.stop();
  });

  it("re-arms the watchers and reports a change when the root returns", async () => {
    const onChange = jest.fn();
    const watcher = new LibraryWatcher(new LibraryRoot("/lib"), onChange, logger, jest.fn());
    watcher.start();
    stat.mockRejectedValue(enoent());
    await jest.advanceTimersByTimeAsync(5_000);
    expect(listeners).toHaveLength(3);

    stat.mockResolvedValue({});
    await jest.advanceTimersByTimeAsync(5_000);

    expect(listeners).toHaveLength(6);
    expect(onChange).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it("does not poll for a watched folder that does not exist", async () => {
    const onChange = jest.fn();
    (watch as jest.Mock).mockImplementation(() => { throw enoent(); });
    const watcher = new LibraryWatcher(new LibraryRoot("/lib"), onChange, logger, jest.fn());
    watcher.start();
    await jest.advanceTimersByTimeAsync(11_000);
    expect(onChange).not.toHaveBeenCalled();
    watcher.stop();
  });

  it("stops checking the root after stop", async () => {
    const watcher = new LibraryWatcher(new LibraryRoot("/lib"), jest.fn(), logger, jest.fn());
    watcher.start();
    watcher.stop();
    await jest.advanceTimersByTimeAsync(20_000);
    expect(stat).not.toHaveBeenCalled();
  });
});
