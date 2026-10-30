/** @jest-environment jsdom */
// 4.2a: the reader notes, the Space notes and discussions, and the library detail pane post `params` and `preview` with their runCell
// message and show a host `cellPreview {requestId, result}` under the cell that asked for it.
//
// Written to sit at packages/core/__tests__/reader/dom/surfacePreview.test.ts (imports are relative to that path).
//
// Assumptions about what the spec leaves open:
// - The cells are driven the way a user does it, through the param strip of spec 4.1: a cell with a `#| param: n = slider(0, 10, 3)` line
//   shows a native <input type="range"> (document order = cell order); an `input` event on it is a drag, a `change` event is the release.
//   The strip debounces previews by 150 ms, so the tests wait 400 ms after a drag.
// - A preview run is posted as runCell with `preview: true` and `params` holding every param of that cell; a normal run after a release has
//   `params` and a falsy `preview`.
// - A preview result is shown as text somewhere under the cell that asked for it: after that cell's range input and before the next cell's.
//   The tests only look at where the text sits in document order, not at the elements around it.
// - Messages are `cellPreview` (reader), `space.cellPreview` and `paper.cellPreview`, each with { requestId, result }.
import { TextEncoder as NodeTextEncoder } from "node:util";
import { ReaderCellRuns } from "../../../src/reader/dom/cellRuns";
import { NotesTab } from "../../../src/reader/dom/notesTab";
import { NoteBoxLayer } from "../../../src/reader/dom/noteBoxes";
import { FloatingNotes } from "../../../src/reader/dom/floatingNotes";
import { attachReaderHostMessages, type HostMessageParts } from "../../../src/reader/dom/readerUi";
import type { ReaderContext } from "../../../src/reader/dom/readerSession";
import type { ReaderNote } from "../../../src/reader/protocol/messages";
import { mountSpaceNotes } from "../../../src/spaces/dom/mountSpaceNotes";
import { mountSpaceDiscussions } from "../../../src/spaces/dom/mountSpaceDiscussions";
import type { SpaceSnapshot } from "../../../src/spaces/dom/mountOverview";
import type { HostToSpaces, SpacesToHost, SpacesTransport } from "../../../src/spaces/spacesProtocol";
import { ALL_CAPABILITIES, mountForTest, paper } from "../../libraryUi/dom/mountHarness";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

const cell = (label: string, name: string, value: number) => `\`\`\`{python}\n#| label: ${label}\n#| param: ${name} = slider(0, 10, ${value})\nprint(${name})\n\`\`\`\n`;
const BODY = `Intro\n\n${cell("a", "n", 3)}\nBetween\n\n${cell("b", "m", 5)}`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const debounce = () => new Promise((resolve) => setTimeout(resolve, 400));
const ranges = (root: ParentNode) => [...root.querySelectorAll<HTMLInputElement>('input[type="range"]')];
const drag = (range: HTMLInputElement, value: number) => { range.value = String(value); range.dispatchEvent(new Event("input", { bubbles: true })); };
const release = (range: HTMLInputElement) => range.dispatchEvent(new Event("change", { bubbles: true }));
const previewResult = (text: string) => ({ status: "ok", language: "python", text, durationMs: 5 });

function textNode(root: Node, needle: string): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) { if ((node.nodeValue ?? "").includes(needle)) { return node as Text; } }
  return null;
}

type Sent = Record<string, unknown>;
interface Subject {
  root: HTMLElement;
  /** The id of the item (note or message) that holds the cells, as the surface's fixture supplies it. */
  itemId: string;
  /** Every runCell-like message the surface posted, in order. */
  runs(): Sent[];
  /** Delivers the host's cellPreview for `requestId`. */
  preview(requestId: string, result: unknown): void;
  dispose(): void;
}

// ---------- reader (Notes tab, with the text boxes and the floating editor wired like the real reader) ----------
async function openReader(): Promise<Subject> {
  const sent: Sent[] = [];
  const handlers = new Map<string, Array<(m: unknown) => void>>();
  const bus = new Map<string, Array<(e?: unknown) => void>>();
  const host = {
    post: (m: Sent) => { sent.push(m); },
    on: (type: string, fn: (m: unknown) => void) => { handlers.set(type, [...(handlers.get(type) ?? []), fn]); },
  };
  const eventBus = {
    on: (name: string, fn: (e?: unknown) => void) => bus.set(name, [...(bus.get(name) ?? []), fn]),
    off: () => undefined,
    dispatch: (name: string, e?: unknown) => (bus.get(name) ?? []).forEach((fn) => fn(e)),
  };
  document.body.innerHTML = `<div id="viewer"><div class="page" data-page-number="2"><div class="canvasWrapper"></div><div class="textLayer"></div></div></div>`;
  const ctx = { host, eventBus, post: host.post } as never;
  const tab = new NotesTab(host as never, jest.fn(), () => 1, eventBus as never);
  document.body.append(tab.el);
  const noteBoxes = new NoteBoxLayer(ctx);
  const rctx = { host, eventBus: { on: jest.fn() }, container: document.getElementById("viewer"), pdfViewer: { currentPageNumber: 2 } } as unknown as ReaderContext;
  const floatingNotes = new FloatingNotes(rctx, jest.fn());
  attachReaderHostMessages({
    ctx: { host, prefs: {} }, ui: { notesTab: tab, noteBoxes, floatingNotes }, keyboard: { dispatch: jest.fn() }, hover: { close: jest.fn() },
  } as unknown as HostMessageParts);
  tab.setCanRunCells(true);
  tab.show([{ id: "n1", anchor: "p2 box 0.1 0.2 0.3 0.4", body: BODY, created: "2026-10-01T00:00:00.000Z", author: "Ana" } as ReaderNote]);
  tab.reveal("n1");
  await settle();
  return {
    root: tab.el,
    itemId: "n1",
    runs: () => sent.filter((m) => m["command"] === "runCell"),
    preview: (requestId, result) => (handlers.get("cellPreview") ?? []).forEach((fn) => fn({ type: "cellPreview", requestId, result })),
    dispose: () => undefined,
  };
}

// ---------- Space notes and discussions ----------
const SPACE_KINDS = [
  { name: "Space notes", mount: mountSpaceNotes, path: "notes/ideas.qmd", title: "Ideas", list: { type: "spaceNotes", spaceId: "s", notes: [{ path: "notes/ideas.qmd", title: "Ideas", updated: "2026-10-01" }] } },
  { name: "Space discussions", mount: mountSpaceDiscussions, path: "discussions/loss.qmd", title: "Which loss?",
    list: { type: "spaceDiscussions", spaceId: "s", threads: [{ path: "discussions/loss.qmd", title: "Which loss?", status: "open", messages: 1, updated: "2026-10-01" }] } },
] as const;

async function openSpace(kind: (typeof SPACE_KINDS)[number]): Promise<Subject> {
  const data = { type: "space", canRunCells: true, space: { id: "s", name: "S", folders: [], papers: [], projects: [], dates: [], extra: {}, invalid: { folders: [], papers: [], projects: [], dates: [] } },
    overview: { focus: [], projects: [], timeline: [] }, glossary: { terms: [] }, projects: [], papers: { folders: [], papers: [] } } as unknown as SpaceSnapshot;
  const sent: SpacesToHost[] = [];
  const listeners = new Set<(m: HostToSpaces) => void>();
  const end: SpacesTransport = { post: (m) => sent.push(m), subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
  const receive = (m: unknown) => listeners.forEach((fn) => fn(m as HostToSpaces));
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const view = kind.mount(root, { data, end, readOnly: false });
  const items = [{ id: "i1", body: BODY, author: "Ana", created: "2026-10-01T00:00:00.000Z" }];
  receive(kind.list);
  receive({ type: "spaceQmd", spaceId: "s", path: kind.path, items });
  await settle();
  if (ranges(root).length === 0) {
    const opener = [...root.querySelectorAll("button")].find((b) => new RegExp(kind.title, "i").test(b.textContent ?? ""));
    opener?.click();
    receive({ type: "spaceQmd", spaceId: "s", path: kind.path, items });
    await settle();
  }
  return {
    root,
    itemId: "i1",
    runs: () => sent.filter((m) => (m as { type: string }).type === "space.runCell") as unknown as Sent[],
    preview: (requestId, result) => receive({ type: "space.cellPreview", requestId, result }),
    dispose: () => view.dispose(),
  };
}

// ---------- library detail pane ----------
async function openPaper(): Promise<Subject> {
  const t = mountForTest({ detailTab: "notes" }, ALL_CAPABILITIES);
  t.snapshot([paper("a", "papers")], ["papers/a"]);
  t.host.post({ type: "select", id: "a" });
  const notes = [{ id: "n1", anchor: "", body: BODY, created: "2026-10-01T00:00:00.000Z", author: "Ana" }];
  t.host.post({ type: "details", id: "a", details: { annotations: [], reading: null, pdf: null, notes, canRunCells: true }, canRunCells: true } as never);
  await settle();
  return {
    root: t.detail(),
    itemId: "n1",
    runs: () => t.sent.filter((m) => m.type === ("paper.runCell" as string)) as unknown as Sent[],
    preview: (requestId, result) => t.host.post({ type: "paper.cellPreview", requestId, result } as never),
    dispose: () => undefined,
  };
}

const SURFACES: Array<{ name: string; open: () => Promise<Subject> }> = [
  { name: "reader Notes tab", open: openReader },
  ...SPACE_KINDS.map((kind) => ({ name: kind.name, open: () => openSpace(kind) })),
  { name: "library detail pane", open: openPaper },
];

describe.each(SURFACES)("4.2a $name", (surface) => {
  it("4.2a posts runCell with preview true and the cell's params while a slider is dragged", async () => {
    const s = await surface.open();
    const [first] = ranges(s.root);
    expect(first).toBeDefined();
    drag(first!, 7);
    await debounce();
    const previews = s.runs().filter((m) => m["preview"] === true);
    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({ itemId: s.itemId, label: "a", language: "python", params: { n: 7 }, preview: true });
    expect(previews[0]!["params"]).toEqual({ n: 7 });
    expect(String(previews[0]!["requestId"]).length).toBeGreaterThan(0);
    s.dispose();
  });

  it("4.2a posts a normal runCell with the params and no preview when the slider is released", async () => {
    const s = await surface.open();
    const [first] = ranges(s.root);
    drag(first!, 7);
    await debounce();
    const request = s.runs().filter((m) => m["preview"] === true).at(-1)!;
    s.preview(String(request["requestId"]), previewResult("PREVIEW-RESULT-7"));
    await settle();
    release(first!);
    await settle();
    const normal = s.runs().filter((m) => !m["preview"]);
    expect(normal).toHaveLength(1);
    expect(normal[0]).toMatchObject({ itemId: s.itemId, label: "a", language: "python", params: { n: 7 } });
    s.dispose();
  });

  it.each([0, 1])("4.2a shows the cellPreview result under cell %i and not under the other cell", async (index) => {
    const s = await surface.open();
    const all = ranges(s.root);
    expect(all).toHaveLength(2);
    drag(all[index]!, 9);
    await debounce();
    const request = s.runs().filter((m) => m["preview"] === true).at(-1)!;
    expect(request["label"]).toBe(index === 0 ? "a" : "b");
    s.preview(String(request["requestId"]), previewResult("PREVIEW-RESULT-9"));
    await settle();
    const shown = textNode(s.root, "PREVIEW-RESULT-9");
    expect(shown).not.toBeNull();
    expect(all[index]!.compareDocumentPosition(shown!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    if (index === 0) { expect(all[1]!.compareDocumentPosition(shown!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy(); }
    s.dispose();
  });

  it("4.2a ignores a cellPreview for a request this surface did not send", async () => {
    const s = await surface.open();
    const [first] = ranges(s.root);
    drag(first!, 9);
    await debounce();
    s.preview("someone-else", previewResult("PREVIEW-STRANGER"));
    await settle();
    expect(textNode(s.root, "PREVIEW-STRANGER")).toBeNull();
    s.dispose();
  });
});

describe("4.2a ReaderCellRuns", () => {
  type Options = { onRunCell?(label: string, code: string, language: string, params?: Record<string, number | string | boolean>, preview?: boolean): void };
  function setup() {
    const sent: Sent[] = [];
    const runs = new ReaderCellRuns({ post: (m: Sent) => { sent.push(m); } } as never);
    document.body.replaceChildren();
    const root = document.body.appendChild(document.createElement("div"));
    runs.setCanRun(true);
    return { sent, onRunCell: (runs.option("n1", root) as Options).onRunCell! };
  }

  it("4.2a posts params and preview true with a preview run", () => {
    const { sent, onRunCell } = setup();
    onRunCell("calc", "print(n)", "python", { n: 7, mode: "fast", on: true }, true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ command: "runCell", itemId: "n1", label: "calc", code: "print(n)", language: "python", params: { n: 7, mode: "fast", on: true }, preview: true });
    expect(String(sent[0]!["requestId"]).length).toBeGreaterThan(0);
  });

  it("4.2a posts params and no preview with a normal run that has params", () => {
    const { sent, onRunCell } = setup();
    onRunCell("calc", "print(n)", "python", { n: 7 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ command: "runCell", params: { n: 7 } });
    expect(sent[0]!["preview"]).toBeFalsy();
  });

  it("4.2a posts neither params nor preview with a run of a cell that has none", () => {
    const { sent, onRunCell } = setup();
    onRunCell("calc", "print(1)", "python");
    expect(sent).toHaveLength(1);
    expect(sent[0]!["preview"]).toBeFalsy();
    expect(sent[0]!["params"]).toBeUndefined();
  });
});
