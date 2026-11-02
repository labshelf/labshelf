/** Pins the webview note view-state store: everything lives under getState().noteView, other state keys survive, and it keeps at most 200 keys. */
/// <reference lib="dom" />
/// <reference path="../../src/webviewGlobals.d.ts" />
import { createWebviewChannel, createWebviewNoteViewStore } from "../../src/webview";

const view = (n: number) => ({ cells: [`cell-${n}`], sections: [], reading: n % 2 === 0, outline: false });

/** A VS Code api whose state is really kept, so what one call saves the next reads. */
function statefulApi(initial: unknown = undefined) {
  let state = initial;
  return {
    api: { getState: () => state, setState: (next: unknown) => { state = next; } },
    state: () => state as Record<string, unknown> | undefined,
    noteView: () => ((state as Record<string, unknown> | undefined)?.["noteView"] ?? {}) as Record<string, unknown>,
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi;
});

describe("createWebviewNoteViewStore", () => {
  it("4.2b saves under noteView and loads the same state back", () => {
    const t = statefulApi({});
    const store = createWebviewNoteViewStore(t.api);
    store.save("paper\nn1", view(1));
    expect(t.noteView()["paper\nn1"]).toEqual(view(1));
    expect(store.load("paper\nn1")).toEqual(view(1));
  });

  it("4.2b keeps an existing `tab` key (and every other key) when it saves", () => {
    const t = statefulApi({ tab: "notes", detailsWidth: 300 });
    const store = createWebviewNoteViewStore(t.api);
    store.save("a\nn1", view(1));
    store.save("a\nn2", view(2));
    expect(t.state()).toMatchObject({ tab: "notes", detailsWidth: 300 });
    expect(Object.keys(t.noteView()).sort()).toEqual(["a\nn1", "a\nn2"]);
  });

  it("4.2b keeps the notes already stored under noteView when it saves another", () => {
    const t = statefulApi({ tab: "x", noteView: { "old\nn1": view(7) } });
    const store = createWebviewNoteViewStore(t.api);
    store.save("new\nn1", view(1));
    expect(store.load("old\nn1")).toEqual(view(7));
    expect(store.load("new\nn1")).toEqual(view(1));
    expect(t.state()?.["tab"]).toBe("x");
  });

  it("4.2b loads undefined for a key never saved, with or without any webview state", () => {
    expect(createWebviewNoteViewStore(statefulApi(undefined).api).load("none")).toBeUndefined();
    expect(createWebviewNoteViewStore(statefulApi({ tab: "a" }).api).load("none")).toBeUndefined();
  });

  it("4.2b saves when the webview has no state yet", () => {
    const t = statefulApi(undefined);
    const store = createWebviewNoteViewStore(t.api);
    store.save("a\nn1", view(1));
    expect(store.load("a\nn1")).toEqual(view(1));
  });

  it("4.2b replaces the state of a key saved twice", () => {
    const t = statefulApi({});
    const store = createWebviewNoteViewStore(t.api);
    store.save("a\nn1", view(1));
    store.save("a\nn1", view(2));
    expect(store.load("a\nn1")).toEqual(view(2));
    expect(Object.keys(t.noteView())).toEqual(["a\nn1"]);
  });

  it("4.2b keeps at most 200 keys and drops the oldest beyond that", () => {
    const t = statefulApi({ tab: "notes" });
    const store = createWebviewNoteViewStore(t.api);
    for (let i = 0; i < 205; i++) { store.save(`k${i}`, view(i)); }
    expect(Object.keys(t.noteView())).toHaveLength(200);
    for (let i = 0; i < 5; i++) { expect(store.load(`k${i}`)).toBeUndefined(); }
    expect(store.load("k5")).toEqual(view(5));
    expect(store.load("k204")).toEqual(view(204));
    expect(t.state()?.["tab"]).toBe("notes");
  });

  it("4.2b moves a saved key to the end, so a recently saved key outlives older ones", () => {
    const t = statefulApi({});
    const store = createWebviewNoteViewStore(t.api);
    for (let i = 0; i < 200; i++) { store.save(`k${i}`, view(i)); }
    store.save("k0", view(999));
    store.save("k200", view(200));
    expect(store.load("k0")).toEqual(view(999));
    expect(store.load("k1")).toBeUndefined();
    expect(store.load("k2")).toEqual(view(2));
    expect(Object.keys(t.noteView())).toHaveLength(200);
  });

  it("4.2b is handed out by createWebviewChannel on the same api", () => {
    try {
    const t = statefulApi({ tab: "notes" });
    (globalThis as { window?: unknown }).window = { addEventListener: () => undefined, removeEventListener: () => undefined };
    const acquire = jest.fn(() => ({ postMessage: jest.fn(), ...t.api }));
    (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = acquire;
    const { viewState } = createWebviewChannel<{ type: "out" }, { type: string }>() as unknown as { viewState: ReturnType<typeof createWebviewNoteViewStore> };
    expect(acquire).toHaveBeenCalledTimes(1);
    viewState.save("a\nn1", view(1));
    expect(t.noteView()["a\nn1"]).toEqual(view(1));
    expect(t.state()?.["tab"]).toBe("notes");
    } catch (error) {
      throw new Error(`not implemented: createWebviewChannel viewState (${error instanceof Error ? error.message : String(error)})`);
    }
  });
});
