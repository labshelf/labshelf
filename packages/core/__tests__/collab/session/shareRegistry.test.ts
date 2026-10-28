// Tests the registry of a window's or page's open shares: busy holds, the entries it lists, and the order of release, notify and close.
import { createShareRegistry, type ShareConnection } from "../../../src/collab/session/index";

interface Entry { id: string; running?: ShareConnection; closeError?: Error }

const connection = (shareId: string): ShareConnection => ({ shareId }) as unknown as ShareConnection;

function registryOf(log: string[] = [], withRelease = false) {
  return createShareRegistry<Entry>({
    connectionOf: (entry) => entry.running,
    close: async (entry) => {
      log.push(`close ${entry.id}`);
      await Promise.resolve();
      if (entry.closeError) throw entry.closeError;
      log.push(`closed ${entry.id}`);
    },
    ...(withRelease ? { onRelease: (entry: Entry) => { log.push(`release ${entry.id}`); } } : {}),
  });
}

describe("createShareRegistry", () => {
  it("marks a share busy while hold runs, also when the task rejects", async () => {
    const registry = registryOf();
    let during = false;
    await expect(registry.hold("a", async () => { during = registry.isBusy("a"); throw new Error("boom"); })).rejects.toThrow("boom");
    expect(during).toBe(true);
    expect(registry.isBusy("a")).toBe(false);
    await expect(registry.hold("a", async () => 7)).resolves.toBe(7);
  });

  it("lists the connections of entries that run one (browser entries may wait for a lease)", () => {
    const registry = registryOf();
    registry.set("a", { id: "a", running: connection("a") });
    registry.set("b", { id: "b" });
    expect(registry.list().map((share) => share.shareId)).toEqual(["a"]);
    expect(registry.active("a")?.shareId).toBe("a");
    expect(registry.active("b")).toBeUndefined();
    expect(registry.entry("b")?.id).toBe("b");
    expect(registry.entries().map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("set does not notify; notify does", () => {
    const registry = registryOf();
    const listener = jest.fn();
    registry.onChange(listener);
    registry.set("a", { id: "a" });
    expect(listener).not.toHaveBeenCalled();
    registry.notify();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("remove runs the release hook, then notifies, then closes (vscode disposes the editor binding first)", async () => {
    const log: string[] = [];
    const registry = registryOf(log, true);
    registry.onChange(() => log.push(`notify ${String(registry.entry("a") === undefined)}`));
    registry.set("a", { id: "a", running: connection("a") });
    const removing = registry.remove("a");
    expect(log).toEqual(["release a", "notify true", "close a"]);
    await removing;
    expect(log).toEqual(["release a", "notify true", "close a", "closed a"]);
  });

  it("remove without a release hook notifies before it closes (browser)", async () => {
    const log: string[] = [];
    const registry = registryOf(log);
    registry.onChange(() => log.push("notify"));
    registry.set("a", { id: "a" });
    await registry.remove("a");
    expect(log).toEqual(["notify", "close a", "closed a"]);
  });

  it("remove rejects with the close error and resolves at once for an unknown share", async () => {
    const log: string[] = [];
    const registry = registryOf(log);
    const listener = jest.fn();
    registry.onChange(listener);
    await registry.remove("missing");
    expect(listener).not.toHaveBeenCalled();
    registry.set("a", { id: "a", closeError: new Error("unstored") });
    await expect(registry.remove("a")).rejects.toThrow("unstored");
    expect(registry.entry("a")).toBeUndefined();
  });

  it("release drops only the entry it names, notifies and does not close", () => {
    const log: string[] = [];
    const registry = registryOf(log);
    const listener = jest.fn();
    registry.onChange(listener);
    const first: Entry = { id: "a" };
    registry.set("a", first);
    registry.release("a", { id: "a" });
    expect(registry.entry("a")).toBe(first);
    expect(listener).not.toHaveBeenCalled();
    registry.release("a", first);
    expect(registry.entry("a")).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(log).toEqual([]);
  });

  it("closeAll empties the registry, closes every entry, notifies once after and returns the failures (browser)", async () => {
    const log: string[] = [];
    const registry = registryOf(log);
    registry.onChange(() => log.push(`notify ${registry.entries().length}`));
    const error = new Error("unstored");
    registry.set("a", { id: "a" });
    registry.set("b", { id: "b", closeError: error });
    const failures = await registry.closeAll();
    expect(failures).toEqual([{ shareId: "b", reason: error }]);
    expect(log).toEqual(["close a", "close b", "closed a", "notify 0"]);
  });

  it("onChange returns an unsubscribe and clearListeners drops every listener", () => {
    const registry = registryOf();
    const first = jest.fn();
    const second = jest.fn();
    const stop = registry.onChange(first);
    registry.onChange(second);
    stop();
    registry.notify();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    registry.clearListeners();
    registry.notify();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
