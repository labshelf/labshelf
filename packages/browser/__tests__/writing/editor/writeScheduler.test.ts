import { AUTO_SAVE_DELAY_MS, type ILogger } from "@labshelf/core";
import { createSaveScheduler, type SaveSchedulerDeps } from "../../../src/writing/editor/writeScheduler";

const logger = (): ILogger => ({ log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) });

function setup(write: SaveSchedulerDeps["write"]) {
  const dirty: boolean[] = [];
  const deps: SaveSchedulerDeps = {
    file: "main.tex", text: () => "body", write: jest.fn(write), logger: logger(), onDirty: (value) => dirty.push(value), onSaved: jest.fn(),
  };
  return { deps, dirty, save: createSaveScheduler(deps) };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("source save scheduler", () => {
  it("writes once, the autosave delay after the last edit", async () => {
    const { deps, dirty, save } = setup(async () => undefined);
    save.changed();
    jest.advanceTimersByTime(AUTO_SAVE_DELAY_MS - 1);
    save.changed();
    jest.advanceTimersByTime(AUTO_SAVE_DELAY_MS - 1);
    expect(deps.write).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(deps.write).toHaveBeenCalledTimes(1);
    expect(deps.write).toHaveBeenCalledWith("body");
    expect(deps.onSaved).toHaveBeenCalledTimes(1);
    expect(dirty).toEqual([true, false]);
    expect(save.dirty()).toBe(false);
  });

  it("writes pending edits on close without waiting for the delay", async () => {
    const { deps, save } = setup(async () => undefined);
    save.changed();
    await expect(save.flush()).resolves.toBe(true);
    expect(deps.write).toHaveBeenCalledTimes(1);
    await expect(save.flush()).resolves.toBe(true);
    expect(deps.write).toHaveBeenCalledTimes(1);
  });

  it("keeps the file dirty and logs when the write fails", async () => {
    const { deps, dirty, save } = setup(async () => { throw new Error("disk full"); });
    save.changed();
    await expect(save.flush()).resolves.toBe(false);
    expect(save.dirty()).toBe(true);
    expect(dirty).toEqual([true]);
    expect(deps.onSaved).not.toHaveBeenCalled();
    expect(deps.logger.error).toHaveBeenCalledWith("editor.save", expect.any(Error), { action: "writeSource", file: "main.tex" });
  });
});
