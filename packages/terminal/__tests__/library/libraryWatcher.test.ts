import { watch } from "node:fs";

import { LibraryWatcher } from "../../src/library/libraryWatcher";
import { LibraryRoot } from "../../src/library/libraryRoot";

jest.mock("node:fs", () => ({ watch: jest.fn() }));

type Listener = (event: string, file: string | Buffer | null) => void;
const listeners: Listener[] = [];

beforeEach(() => {
  listeners.length = 0;
  jest.useFakeTimers();
  (watch as jest.Mock).mockImplementation((_dir: string, _opts: unknown, listener: Listener) => {
    listeners.push(listener);
    return { on: jest.fn(), close: jest.fn() };
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("LibraryWatcher", () => {
  it("ignores noise, counts a null filename as a change and debounces", () => {
    const onChange = jest.fn();
    const watcher = new LibraryWatcher(new LibraryRoot("/lib"), onChange);
    watcher.start();
    expect(listeners).toHaveLength(2);

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
});
