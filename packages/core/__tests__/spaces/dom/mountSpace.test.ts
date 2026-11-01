/** @jest-environment jsdom */
// Tests the note bar in the Spaces notes view with the real editors: the bar sits above the note's items, its Run all posts space.runCell for the
// items' cells in s.items order, one cell at a time, it is disabled without a runner, and the view state port is keyed
// `space:${spaceId}:${path}\n${itemId}`.
//
// Assumptions about what the spec leaves open: MountSpaceOptions.viewState is the QmdViewStatePort; the bar is the `.qmd-note-bar` element with a
// button aria-label 'Run all' (plan decided of spec 4.1); a cell run ends when the host posts a matching space.cellState 'done'.
import { TextEncoder as NodeTextEncoder } from "node:util";
import { mountSpace } from "../../../src/spaces/dom/mountSpace";
import { mountSpaceNotes } from "../../../src/spaces/dom/mountSpaceNotes";
import type { SpaceSnapshot } from "../../../src/spaces/dom/mountOverview";
import type { HostToSpaces, SpacesToHost, SpacesTransport } from "../../../src/spaces/spacesProtocol";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}
// jsdom has no layout; CodeMirror measures text ranges.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

/** Turns any failure into "not implemented: ..." so a red run shows the behaviour is absent; the original message is kept. */
const it = (name: string, body: () => Promise<void> | void): void => {
  globalThis.it(name, async () => {
    try { await body(); } catch (error) { throw new Error(`not implemented: the note bar (${error instanceof Error ? error.message : String(error)})`); }
  }, 20000);
};

const PATH = "notes/ideas.qmd";
const cellBody = (label: string): string => `Intro ${label}\n\n\`\`\`{python}\n#| label: ${label}\nprint("${label}")\n\`\`\`\n`;
// The ids are not in alphabetical order, so only s.items order gives b before a.
const ITEMS = [
  { id: "b", body: cellBody("cb"), author: "Ana", created: "2026-10-01T00:00:00.000Z" },
  { id: "a", body: cellBody("ca"), author: "Ana", created: "2026-10-02T00:00:00.000Z" },
];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await wait(10);
}
const find = (root: ParentNode, re: RegExp) => [...root.querySelectorAll("button")].find((b) => re.test(`${b.textContent ?? ""} ${b.getAttribute("aria-label") ?? ""}`));
const runAll = (root: ParentNode) => root.querySelector<HTMLButtonElement>('.qmd-note-bar button[aria-label="Run all"]');

function makeData(canRunCells: boolean): SpaceSnapshot {
  return { type: "space", canRunCells, space: { id: "s", name: "S", folders: [], papers: [], projects: [], dates: [], extra: {}, invalid: { folders: [], papers: [], projects: [], dates: [] } },
    overview: { focus: [], projects: [], timeline: [] }, glossary: { terms: [] }, projects: [], papers: { folders: [], papers: [] } } as unknown as SpaceSnapshot;
}

function makeEnd() {
  const sent: SpacesToHost[] = [];
  const listeners = new Set<(m: HostToSpaces) => void>();
  const end: SpacesTransport = { post: (m) => sent.push(m), subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
  const receive = (m: unknown) => listeners.forEach((fn) => fn(m as HostToSpaces));
  const runs = () => sent.filter((m) => (m as { type: string }).type === "space.runCell") as unknown as Array<{ itemId: string; label: string; requestId: string }>;
  const finish = (index: number, state: "done" | "error" = "done") => {
    const requestId = runs()[index]!.requestId;
    receive({ type: "space.cellState", requestId, state: "running" });
    receive({ type: "space.cellState", requestId, state });
  };
  return { sent, end, receive, runs, finish };
}

async function openNotes(canRunCells: boolean) {
  const t = makeEnd();
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const body = mountSpaceNotes(root, { data: makeData(canRunCells), end: t.end, readOnly: false });
  t.receive({ type: "spaceNotes", spaceId: "s", notes: [{ path: PATH, title: "Ideas", updated: "2026-10-01" }] });
  t.receive({ type: "spaceQmd", spaceId: "s", path: PATH, items: ITEMS });
  await wait(60);
  if (!root.querySelector(".qmd-note-bar") && !root.querySelector(".qmd-cell")) {
    find(root, /ideas/i)?.click();
    t.receive({ type: "spaceQmd", spaceId: "s", path: PATH, items: ITEMS });
    await wait(100);
  }
  return { ...t, root, body };
}

describe("Space notes note bar", () => {
  it("4.3a shows one note bar above the items of the note", async () => {
    const t = await openNotes(true);
    expect(t.root.querySelectorAll(".qmd-note-bar")).toHaveLength(1);
    const bar = t.root.querySelector(".qmd-note-bar")!;
    const firstItem = t.root.querySelector(".nt-item")!;
    expect(firstItem).not.toBeNull();
    expect(bar.compareDocumentPosition(firstItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    t.body.dispose();
  });

  it("4.3a Run all posts space.runCell for the items' cells in s.items order, one cell at a time", async () => {
    const t = await openNotes(true);
    runAll(t.root)!.click();
    await until(() => t.runs().length >= 1);
    expect(t.runs().map((r) => `${r.itemId}:${r.label}`)).toEqual(["b:cb"]);
    await wait(150);
    expect(t.runs()).toHaveLength(1);
    t.finish(0);
    await until(() => t.runs().length >= 2);
    expect(t.runs().map((r) => `${r.itemId}:${r.label}`)).toEqual(["b:cb", "a:ca"]);
    t.finish(1);
    await wait(60);
    t.body.dispose();
  });

  it("4.3a Run all stops at a cell that ends in error and does not post the next item's cell", async () => {
    const t = await openNotes(true);
    runAll(t.root)!.click();
    await until(() => t.runs().length >= 1);
    t.finish(0, "error");
    await wait(300);
    expect(t.runs().map((r) => r.itemId)).toEqual(["b"]);
    t.body.dispose();
  });

  it("4.3a disables Run all with the title 'No runner for this note' when the host cannot run cells", async () => {
    const t = await openNotes(false);
    const button = runAll(t.root);
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(true);
    expect(button!.title).toBe("No runner for this note");
    button!.click();
    await wait(100);
    expect(t.runs()).toEqual([]);
    t.body.dispose();
  });
});

describe("Space note view state", () => {
  it("4.3a loads each item's view state under space:<spaceId>:<path>\\n<itemId>", async () => {
    const port = { load: jest.fn((_key: string): unknown => undefined), save: jest.fn() };
    const t = makeEnd();
    document.body.replaceChildren();
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = mountSpace(root, t.end, { id: "s", tab: "notes", viewState: port } as never);
    t.receive({ type: "spaceNotes", spaceId: "s", notes: [{ path: PATH, title: "Ideas", updated: "2026-10-01" }] });
    t.receive(makeData(true));
    await wait(60);
    find(root, /ideas/i)?.click();
    t.receive({ type: "spaceQmd", spaceId: "s", path: PATH, items: ITEMS });
    await wait(150);
    const keys = port.load.mock.calls.map((call) => call[0]);
    expect(keys).toContain(`space:s:${PATH}\nb`);
    expect(keys).toContain(`space:s:${PATH}\na`);
    dispose();
  });
});
