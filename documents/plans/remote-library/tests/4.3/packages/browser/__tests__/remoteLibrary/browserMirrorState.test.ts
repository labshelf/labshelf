// Pins the browser Mirror state store: per-library state in extension storage, undefined when unset, cleared on turn off.
import { createBrowserMirrorStateStore } from "../../src/remoteLibrary/browserMirrorState";

type Store = ReturnType<typeof createBrowserMirrorStateStore>;
type State = Parameters<Store["write"]>[0];

function memoryArea() {
  const items = new Map<string, unknown>();
  return {
    items,
    get: async (key: string): Promise<Record<string, unknown>> => (items.has(key) ? { [key]: items.get(key) } : {}),
    set: async (values: Record<string, unknown>): Promise<void> => { for (const [key, value] of Object.entries(values)) items.set(key, value); },
    remove: async (key: string): Promise<void> => { items.delete(key); },
  };
}

const STATE_A: State = { version: 1, relayUrl: "https://r.example.workers.dev", rows: { "papers/a.json": { hash: "h1", size: 10, kind: "papers" } } };
const STATE_B: State = { version: 1, relayUrl: "https://r.example.workers.dev", rows: { "notes/b.md": { hash: "h2", size: 20, kind: "notes" } } };

describe("createBrowserMirrorStateStore", () => {
  it("4.3a reads undefined when nothing was written", async () => {
    const store = createBrowserMirrorStateStore(memoryArea(), async () => "lib-1");
    await expect(store.read()).resolves.toBeUndefined();
  });

  it("4.3a round-trips the state it wrote", async () => {
    const store = createBrowserMirrorStateStore(memoryArea(), async () => "lib-1");
    await store.write(STATE_A);
    await expect(store.read()).resolves.toEqual(STATE_A);
  });

  it("4.3a overwrites an earlier state on the next write", async () => {
    const store = createBrowserMirrorStateStore(memoryArea(), async () => "lib-1");
    await store.write(STATE_A);
    await store.write(STATE_B);
    await expect(store.read()).resolves.toEqual(STATE_B);
  });

  it("4.3a clear makes the next read undefined", async () => {
    const store = createBrowserMirrorStateStore(memoryArea(), async () => "lib-1");
    await store.write(STATE_A);
    await store.clear();
    await expect(store.read()).resolves.toBeUndefined();
  });

  it("4.3a clear on an unset state does not throw", async () => {
    const store = createBrowserMirrorStateStore(memoryArea(), async () => "lib-1");
    await expect(store.clear()).resolves.toBeUndefined();
  });

  it("4.3a keeps the state of two libraries apart", async () => {
    const area = memoryArea();
    let current = "lib-1";
    const store = createBrowserMirrorStateStore(area, async () => current);
    await store.write(STATE_A);
    current = "lib-2";
    await expect(store.read()).resolves.toBeUndefined();
    await store.write(STATE_B);
    current = "lib-1";
    await expect(store.read()).resolves.toEqual(STATE_A);
    current = "lib-2";
    await expect(store.read()).resolves.toEqual(STATE_B);
  });

  it("4.3a clear only removes the current library's state", async () => {
    const area = memoryArea();
    let current = "lib-1";
    const store = createBrowserMirrorStateStore(area, async () => current);
    await store.write(STATE_A);
    current = "lib-2";
    await store.write(STATE_B);
    await store.clear();
    current = "lib-1";
    await expect(store.read()).resolves.toEqual(STATE_A);
    current = "lib-2";
    await expect(store.read()).resolves.toBeUndefined();
  });

  it("4.3a asks for the library id on every call", async () => {
    const area = memoryArea();
    const libraryId = jest.fn(async () => "lib-1");
    const store = createBrowserMirrorStateStore(area, libraryId);
    await store.write(STATE_A);
    await store.read();
    await store.clear();
    expect(libraryId.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
