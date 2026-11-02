/** @jest-environment jsdom */
// Tests the library detail pane's note bar (plan notebook-flow D10, D5): one `.qmd-note-bar` before the first note item, whose Run all runs
// every item's cells in DOM order and skips the empty new-item editor; the pane's view-state port reaches each item editor, keyed `${paper}\n${itemId}`.
//
// Item editors are mocked with partial handles (as detailPane/detailPane.test.ts does); their notebook cells record the order they run in. The new-item
// editor's cell records "new", so a run that reaches it shows up.
import { TextEncoder as NodeTextEncoder } from "node:util";
import { DEFAULT_PREFS, createLoopbackTransport } from "@labshelf/core";
import { ALL_CAPABILITIES, LABELS, paper } from "./mountHarness";
import { createUiCompositionRoot, mountDetailPane, mountLibraryUi } from "../../../src/libraryUi/dom";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

const mockRan: string[] = [];
const mockMounted: Array<{ itemId: string; options: Record<string, unknown> }> = [];

jest.mock("../../../src/qmd/dom/index", () => ({
  ...jest.requireActual("../../../src/qmd/dom/index"),
  QMD_VOCABULARY: { item: "note" },
  mountQmdEditor: (root: HTMLElement, options: Record<string, unknown>) => {
    const own = root.dataset["item"] ?? "";
    mockMounted.push({ itemId: own, options });
    let destroyed = false;
    return {
      setBody: jest.fn(), focus: jest.fn(), flush: jest.fn(),
      destroy: () => { destroyed = true; },
      notebook: (itemId = "") => destroyed ? [] : [1, 2].map((n) => ({
        key: `${itemId}#c${n}`, itemId, language: "python", sectionKeys: [],
        run: async () => { mockRan.push(own === "" ? `new:c${n}` : `${own}:c${n}`); return "ok" as const; },
        cancel: jest.fn(), setQueue: jest.fn(),
      })),
      sections: () => [], markUpstreamChange: jest.fn(), collapseAll: jest.fn(), expandAll: jest.fn(), setReading: jest.fn(),
      foldState: () => ({ cells: [], sections: [], reading: false }),
    };
  },
}));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Turns any failure into "not implemented: ..." so a red run shows the behaviour is absent; the original message is kept. */
const behaviour = (body: () => Promise<void>) => async (): Promise<void> => {
  try {
    await body();
  } catch (error) {
    throw new Error(`not implemented: note bar in this host (${error instanceof Error ? error.message : String(error)})`);
  }
};

const items = [
  { id: "n1", anchor: "", body: "```{python}\nprint(1)\n```\n", created: "2026-10-01T00:00:00.000Z", author: "Ana" },
  { id: "n2", anchor: "", body: "```{python}\nprint(2)\n```\n", created: "2026-10-02T00:00:00.000Z", author: "Ana" },
];

function mount(notes: typeof items, viewState?: unknown, canRunCells = true) {
  mockRan.length = 0;
  mockMounted.length = 0;
  document.body.innerHTML = "";
  Element.prototype.scrollIntoView = () => undefined;
  const { ui, host } = createLoopbackTransport();
  const container = document.createElement("div");
  document.body.append(container);
  const prefs = { load: () => ({ ...DEFAULT_PREFS, detailTab: "notes" as const }), save: () => undefined };
  const lib = mountLibraryUi(container, { transport: ui, capabilities: ALL_CAPABILITIES, labels: LABELS, prefs });
  const detailEl = document.createElement("aside");
  detailEl.className = "detail-pane";
  container.append(detailEl);
  const deps = { store: lib.store, transport: ui, prefs, caps: ALL_CAPABILITIES, labels: LABELS, readOnly: false, ...(viewState ? { viewState } : {}) };
  const ctx = createUiCompositionRoot(container, deps as never);
  const off = mountDetailPane(ctx, detailEl);
  host.post({ type: "snapshot", snapshot: JSON.parse(JSON.stringify({ folders: [], papers: [paper("a", "papers")], pdfDirs: ["papers/a"], stats: {} })) });
  host.post({ type: "select", id: "a" });
  host.post({ type: "details", id: "a", details: { annotations: [], reading: null, pdf: null, notes, canRunCells }, canRunCells } as never);
  return { detailEl, off: () => { off(); lib.dispose(); } };
}

describe("library detail pane note bar", () => {
  it("4.2a shows one note bar, placed before the first note item", behaviour(async () => {
    const t = mount(items);
    await wait(100);
    const bars = t.detailEl.querySelectorAll<HTMLElement>(".qmd-note-bar");
    expect(bars).toHaveLength(1);
    const first = t.detailEl.querySelector<HTMLElement>(".note-item")!;
    expect(first).not.toBeNull();
    expect(bars[0]!.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    t.off();
  }));

  it("4.2a runs both items' cells in order on Run all and skips the empty new-item editor", behaviour(async () => {
    const t = mount(items);
    await wait(100);
    expect(mockMounted.some((m) => m.itemId === "")).toBe(true);
    t.detailEl.querySelector<HTMLButtonElement>('.qmd-note-bar button[aria-label="Run all"]')!.click();
    await wait(200);
    expect(mockRan).toEqual(["n1:c1", "n1:c2", "n2:c1", "n2:c2"]);
    t.off();
  }));

  it("4.2a shows no note bar when the paper has no note items", behaviour(async () => {
    const withItems = mount(items);
    await wait(100);
    expect(withItems.detailEl.querySelector(".qmd-note-bar")).not.toBeNull();
    withItems.off();
    const t = mount([]);
    await wait(100);
    expect(t.detailEl.querySelector(".qmd-note-bar")).toBeNull();
    t.off();
  }));

  it("4.2a disables Run all when the host cannot run cells", behaviour(async () => {
    const t = mount(items, undefined, false);
    await wait(100);
    const button = t.detailEl.querySelector<HTMLButtonElement>('.qmd-note-bar button[aria-label="Run all"]');
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(true);
    button!.click();
    await wait(100);
    expect(mockRan).toEqual([]);
    t.off();
  }));

  it("4.2a hands each item editor the pane's view-state port under the key `${paper}\\n${itemId}`", behaviour(async () => {
    const port = { load: jest.fn(() => undefined), save: jest.fn() };
    const t = mount(items, port);
    await wait(100);
    const keyed = mockMounted.filter((m) => m.itemId !== "").map((m) => [m.itemId, m.options["viewState"] as { port: unknown; key: string } | undefined] as const);
    expect(keyed.map(([id]) => id)).toEqual(expect.arrayContaining(["n1", "n2"]));
    for (const [id, vs] of keyed) {
      expect(vs?.port).toBe(port);
      expect(vs?.key).toBe(`a\n${id}`);
    }
    t.off();
  }));

  it("4.2a passes no view state to the editors when the pane has no port", behaviour(async () => {
    const t = mount(items);
    await wait(100);
    expect(t.detailEl.querySelector(".qmd-note-bar")).not.toBeNull();
    expect(mockMounted.filter((m) => m.itemId !== "").every((m) => m.options["viewState"] === undefined)).toBe(true);
    t.off();
  }));
});
