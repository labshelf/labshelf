/** @jest-environment jsdom */
// 3.2a: every editor mount passes `onEvalMath` and `cellsAbove` to the editor.
//
// Written to sit at packages/core/__tests__/qmd/dom/evalMathMounts.test.ts (imports are relative to that path).
//
// Assumptions about what the spec leaves open:
// - The tests read the options each mount hands to `mountQmdEditor` (the module is wrapped to record them and still mounts the real editor).
//   Nothing here depends on the 3.3 trigger: the options are called directly, the way the editor will.
// - `onEvalMath(request, callback)`: `request` is `{ op, tex }`; the callback receives the host's `result` as is.
// - `cellsAbove(pos)` is synchronous (a promise is tolerated) and returns the code strings of the Mathematica cells, earlier items
//   first (in the order the surface lists its items), then the cells of this item that sit before ProseMirror position `pos` of the
//   item's body document. Trailing newlines of a code string do not matter. Python cells are left out.
// - Host messages follow plan D6 and the session 2 names. Reader: `{ command: "evalMath", requestId, itemId, op, tex }` and
//   `{ type: "mathResult", requestId, result }`. Library detail pane: `paper.evalMath` (with the paper `id`) and `paper.mathResult`.
//   Spaces: `space.evalMath` (with the note `path`) and `space.mathResult`. Each carries `requestId`, `op` and `tex`.
// - In the reader the Notes tab opens one note at a time and lists them in the order `show` was given; the fixture notes share an
//   anchor and are created in that order, so the tab's own sort agrees with it.
// - Not covered here: the browser's project notes (packages/browser/src/libraryUi/editorArea/projectNoteTab.ts). They need the
//   browser's helper port and a TabContext, and this spec's test command runs the core package only.
import { TextEncoder as NodeTextEncoder } from "node:util";
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
import { bodyToDoc } from "../../../src/qmd/editor/index";
import { ALL_CAPABILITIES, mountForTest, paper } from "../../libraryUi/dom/mountHarness";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

type MathResultFixture = Record<string, unknown>;
interface Captured {
  body: string;
  readOnly?: boolean;
  onEvalMath?: (request: { op: string; tex: string }, callback: (result: MathResultFixture) => void) => void;
  cellsAbove?: (pos: number) => readonly string[] | Promise<readonly string[]>;
}

const mockMounted: Captured[] = [];
jest.mock("../../../src/qmd/dom/qmdEditor", () => {
  const actual = jest.requireActual("../../../src/qmd/dom/qmdEditor");
  return {
    ...actual,
    mountQmdEditor: (root: HTMLElement, options: Captured) => {
      mockMounted.push(options);
      return actual.mountQmdEditor(root, options);
    },
  };
});

const ITEM_A = "Alpha item\n\n```{mathematica}\nfirst = 1\n```\n\nAlpha middle\n\n```{python}\nskipped = 9\n```\n\n```{mathematica}\nsecond = 2\n```\n\nAlpha end\n";
const ITEM_B = "Bravo intro\n\n```{mathematica}\nthird = 3\n```\n\nBravo middle\n\n```{mathematica}\nfourth = 4\n```\n\nBravo end\n";
const ITEM_C = "Charlie item\n\n```{mathematica}\nfifth = 5\n```\n\nCharlie end\n";
const BODIES = [ITEM_A, ITEM_B, ITEM_C];
const MARKERS = ["Alpha item", "Bravo intro", "Charlie item"];

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
type Sent = Record<string, unknown>;
const RESULT: MathResultFixture = { state: "value", latex: "\\frac{1}{3}", readAs: "Integrate[x^2, {x, 0, 1}]", rewrites: [], messages: [] };
const OTHER: MathResultFixture = { state: "value", latex: "4", readAs: "Plus[2, 2]", rewrites: [], messages: [] };

interface Surface {
  name: string;
  /** Whether the surface can be mounted read-only. */
  canBeReadOnly: boolean;
  mount(options: { canRun: boolean; readOnly?: boolean }): Promise<void>;
  /** The options of the editor now mounted for item `index` (the reader opens that note first). */
  editor(index: number): Captured;
  /** The evalMath messages the surface posted to its host, in order. */
  evalMessages(): Sent[];
  /** Checks that `message` names item `index` the way the surface's host message does. */
  expectTarget(message: Sent, index: number): void;
  reply(requestId: string, result: MathResultFixture): void;
  /** A cell preview for `requestId`, which must not reach math callbacks. */
  preview(requestId: string): void;
  dispose(): void;
}

const last = (marker: string): Captured | undefined => [...mockMounted].reverse().find((options) => options.body.includes(marker));
const requestIdOf = (message: Sent): string => message["requestId"] as string;
const previewResult = { status: "ok", language: "python", text: "from a preview", durationMs: 5 };

// ---------- reader (Notes tab wired like the real reader) ----------
function readerSurface(): Surface {
  const sent: Sent[] = [];
  const handlers = new Map<string, Array<(m: unknown) => void>>();
  const bus = new Map<string, Array<(e?: unknown) => void>>();
  let tab: NotesTab | undefined;
  return {
    name: "reader",
    canBeReadOnly: false,
    async mount({ canRun }) {
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
      tab = new NotesTab(host as never, jest.fn(), () => 1, eventBus as never);
      document.body.append(tab.el);
      const noteBoxes = new NoteBoxLayer(ctx);
      const rctx = { host, eventBus: { on: jest.fn() }, container: document.getElementById("viewer"), pdfViewer: { currentPageNumber: 2 } } as unknown as ReaderContext;
      const floatingNotes = new FloatingNotes(rctx, jest.fn());
      attachReaderHostMessages({
        ctx: { host, prefs: {} }, ui: { notesTab: tab, noteBoxes, floatingNotes }, keyboard: { dispatch: jest.fn() }, hover: { close: jest.fn() },
      } as unknown as HostMessageParts);
      if (canRun) tab.setCanRunCells(true);
      tab.show(BODIES.map((body, at) => ({
        id: `n${at + 1}`, anchor: "p2 box 0.1 0.2 0.3 0.4", body, created: `2026-10-0${at + 1}T00:00:00.000Z`, author: "Ana",
      }) as ReaderNote));
      await settle();
    },
    editor(index) {
      tab!.reveal(`n${index + 1}`);
      return last(MARKERS[index]!)!;
    },
    evalMessages: () => sent.filter((m) => m["command"] === "evalMath"),
    expectTarget(message, index) { expect(message["itemId"]).toBe(`n${index + 1}`); },
    reply: (requestId, result) => (handlers.get("mathResult") ?? []).forEach((fn) => fn({ type: "mathResult", requestId, result })),
    preview: (requestId) => (handlers.get("cellPreview") ?? []).forEach((fn) => fn({ type: "cellPreview", requestId, result: previewResult })),
    dispose: () => undefined,
  };
}

// ---------- Space notes and discussions ----------
function spaceSurface(name: string, mount: typeof mountSpaceNotes | typeof mountSpaceDiscussions, path: string, title: string, list: unknown): Surface {
  const sent: SpacesToHost[] = [];
  const listeners = new Set<(m: HostToSpaces) => void>();
  const receive = (m: unknown) => listeners.forEach((fn) => fn(m as HostToSpaces));
  let view: { dispose(): void } | undefined;
  return {
    name,
    canBeReadOnly: true,
    async mount({ canRun, readOnly }) {
      const data = { type: "space", canRunCells: canRun, space: { id: "s", name: "S", folders: [], papers: [], projects: [], dates: [], extra: {}, invalid: { folders: [], papers: [], projects: [], dates: [] } },
        overview: { focus: [], projects: [], timeline: [] }, glossary: { terms: [] }, projects: [], papers: { folders: [], papers: [] } } as unknown as SpaceSnapshot;
      const end: SpacesTransport = { post: (m) => sent.push(m), subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
      document.body.replaceChildren();
      const root = document.createElement("div");
      document.body.append(root);
      view = mount(root, { data, end, readOnly: readOnly === true });
      const items = BODIES.map((body, at) => ({ id: `i${at + 1}`, body, author: "Ana", created: `2026-10-0${at + 1}T00:00:00.000Z` }));
      receive(list);
      receive({ type: "spaceQmd", spaceId: "s", path, items });
      await settle();
      if (!last(MARKERS[0]!)) {
        const opener = [...root.querySelectorAll("button")].find((b) => new RegExp(title, "i").test(b.textContent ?? ""));
        opener?.click();
        receive({ type: "spaceQmd", spaceId: "s", path, items });
        await settle();
      }
    },
    editor: (index) => last(MARKERS[index]!)!,
    evalMessages: () => sent.filter((m) => (m as { type: string }).type === "space.evalMath") as unknown as Sent[],
    expectTarget(message, index) {
      expect(message["path"]).toBe(path);
      void index;
    },
    reply: (requestId, result) => receive({ type: "space.mathResult", requestId, result }),
    preview: (requestId) => receive({ type: "space.cellPreview", requestId, result: previewResult }),
    dispose: () => view?.dispose(),
  };
}

// ---------- library detail pane ----------
function paperSurface(): Surface {
  let t: ReturnType<typeof mountForTest> | undefined;
  return {
    name: "library detail pane",
    canBeReadOnly: false,
    async mount({ canRun }) {
      t = mountForTest({ detailTab: "notes" }, ALL_CAPABILITIES);
      t.snapshot([paper("a", "papers")], ["papers/a"]);
      t.host.post({ type: "select", id: "a" });
      const notes = BODIES.map((body, at) => ({ id: `n${at + 1}`, anchor: "", body, created: `2026-10-0${at + 1}T00:00:00.000Z`, author: "Ana" }));
      t.host.post({ type: "details", id: "a", details: { annotations: [], reading: null, pdf: null, notes, canRunCells: canRun }, canRunCells: canRun } as never);
      await settle();
    },
    editor: (index) => last(MARKERS[index]!)!,
    evalMessages: () => t!.sent.filter((m) => m.type === ("paper.evalMath" as string)) as unknown as Sent[],
    expectTarget(message) { expect(message["id"]).toBe("a"); },
    reply: (requestId, result) => t!.host.post({ type: "paper.mathResult", requestId, result } as never),
    preview: (requestId) => t!.host.post({ type: "paper.cellPreview", requestId, result: previewResult } as never),
    dispose: () => undefined,
  };
}

const NOTES_LIST = { type: "spaceNotes", spaceId: "s", notes: [{ path: "notes/ideas.qmd", title: "Ideas", updated: "2026-10-01" }] };
const THREADS_LIST = { type: "spaceDiscussions", spaceId: "s", threads: [{ path: "discussions/loss.qmd", title: "Which loss?", status: "open", messages: 3, updated: "2026-10-01" }] };

const SURFACES: Array<() => Surface> = [
  readerSurface,
  paperSurface,
  () => spaceSurface("Space notes", mountSpaceNotes, "notes/ideas.qmd", "Ideas", NOTES_LIST),
  () => spaceSurface("Space discussions", mountSpaceDiscussions, "discussions/loss.qmd", "Which loss?", THREADS_LIST),
];

/** The ProseMirror position just inside the first paragraph of `body` that holds `text`. */
function posInside(body: string, text: string): number {
  let found = -1;
  bodyToDoc(body).descendants((node, pos) => {
    if (found < 0 && node.type.name === "paragraph" && node.textContent.includes(text)) found = pos + 1;
    return found < 0;
  });
  if (found < 0) throw new Error(`no paragraph with ${text}`);
  return found;
}
const endOf = (body: string): number => bodyToDoc(body).content.size;
const codes = async (options: Captured, pos: number): Promise<string[]> =>
  [...(await Promise.resolve(options.cellsAbove!(pos)))].map((code) => code.replace(/\n+$/, ""));
const REQUEST = { op: "eval", tex: "\\int_0^1 x^2\\,dx" };

beforeEach(() => { mockMounted.length = 0; });

for (const make of SURFACES) {
  const surface = make();
  const { name } = surface;
  let current: Surface;
  const open = async (options: { canRun: boolean; readOnly?: boolean } = { canRun: true }): Promise<Surface> => {
    current = make();
    await current.mount(options);
    return current;
  };
  afterEach(() => { current?.dispose(); });

  it(`3.2a ${name} gives each editor onEvalMath and cellsAbove when the host can run cells`, async () => {
    await open();
    for (let at = 0; at < BODIES.length; at++) {
      const options = current.editor(at);
      expect(typeof options.onEvalMath).toBe("function");
      expect(typeof options.cellsAbove).toBe("function");
    }
  });

  it(`3.2a ${name} sends the request to its host message with a request id, op and tex`, async () => {
    await open();
    current.editor(1).onEvalMath!(REQUEST, jest.fn());
    const messages = current.evalMessages();
    expect(messages).toHaveLength(1);
    expect(typeof messages[0]!["requestId"]).toBe("string");
    expect(requestIdOf(messages[0]!)).not.toBe("");
    expect(messages[0]!["op"]).toBe("eval");
    expect(messages[0]!["tex"]).toBe(REQUEST.tex);
    current.expectTarget(messages[0]!, 1);
  });

  it(`3.2a ${name} hands the host's result for that request id to the callback`, async () => {
    await open();
    const callback = jest.fn();
    current.editor(0).onEvalMath!(REQUEST, callback);
    expect(callback).not.toHaveBeenCalled();
    current.reply(requestIdOf(current.evalMessages()[0]!), RESULT);
    await settle();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]![0]).toEqual(RESULT);
  });

  it(`3.2a ${name} gives two requests different ids and routes each reply to its own callback`, async () => {
    await open();
    const first = jest.fn();
    const second = jest.fn();
    const options = current.editor(0);
    options.onEvalMath!({ op: "eval", tex: "1+1" }, first);
    options.onEvalMath!({ op: "numeric", tex: "2+2" }, second);
    const [one, two] = current.evalMessages();
    expect(requestIdOf(one!)).not.toBe(requestIdOf(two!));
    current.reply(requestIdOf(two!), OTHER);
    await settle();
    expect(first).not.toHaveBeenCalled();
    expect(second.mock.calls[0]![0]).toEqual(OTHER);
    current.reply(requestIdOf(one!), RESULT);
    await settle();
    expect(first.mock.calls[0]![0]).toEqual(RESULT);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it(`3.2a ${name} ignores a math result for a request it did not send`, async () => {
    await open();
    const callback = jest.fn();
    current.editor(0).onEvalMath!(REQUEST, callback);
    expect(() => current.reply("nobody-sent-this", RESULT)).not.toThrow();
    await settle();
    expect(callback).not.toHaveBeenCalled();
  });

  it(`3.2a ${name} keeps cell previews apart from math results`, async () => {
    await open();
    const callback = jest.fn();
    current.editor(0).onEvalMath!(REQUEST, callback);
    current.preview(requestIdOf(current.evalMessages()[0]!));
    await settle();
    expect(callback).not.toHaveBeenCalled();
  });

  it(`3.2a ${name} leaves onEvalMath undefined when the host cannot run cells`, async () => {
    await open({ canRun: false });
    for (let at = 0; at < BODIES.length; at++) {
      expect(current.editor(at).onEvalMath).toBeUndefined();
    }
    expect(current.evalMessages()).toHaveLength(0);
  });

  it(`3.2a ${name} cellsAbove of the first item lists its own Mathematica cells before the position`, async () => {
    await open();
    const options = current.editor(0);
    expect(await codes(options, 0)).toEqual([]);
    expect(await codes(options, posInside(ITEM_A, "Alpha middle"))).toEqual(["first = 1"]);
    expect(await codes(options, endOf(ITEM_A))).toEqual(["first = 1", "second = 2"]);
  });

  it(`3.2a ${name} cellsAbove leaves out cells that are not Mathematica`, async () => {
    await open();
    const all = await codes(current.editor(0), endOf(ITEM_A));
    expect(all).not.toContain("skipped = 9");
    expect(all).toHaveLength(2);
  });

  it(`3.2a ${name} cellsAbove of a later item puts the earlier items' cells first, then its own before the position`, async () => {
    await open();
    const options = current.editor(1);
    expect(await codes(options, posInside(ITEM_B, "Bravo middle"))).toEqual(["first = 1", "second = 2", "third = 3"]);
    expect(await codes(options, endOf(ITEM_B))).toEqual(["first = 1", "second = 2", "third = 3", "fourth = 4"]);
  });

  it(`3.2a ${name} cellsAbove at the start of a later item holds only the earlier items' cells`, async () => {
    await open();
    expect(await codes(current.editor(1), 0)).toEqual(["first = 1", "second = 2"]);
  });

  it(`3.2a ${name} cellsAbove of the third item lists both earlier items in order`, async () => {
    await open();
    expect(await codes(current.editor(2), endOf(ITEM_C))).toEqual(["first = 1", "second = 2", "third = 3", "fourth = 4", "fifth = 5"]);
  });

  it(`3.2a ${name} cellsAbove does not include cells of items below`, async () => {
    await open();
    const all = await codes(current.editor(0), endOf(ITEM_A));
    expect(all).not.toContain("third = 3");
    expect(all).not.toContain("fifth = 5");
  });

  if (surface.canBeReadOnly) {
    it(`3.2a ${name} leaves onEvalMath undefined when the view is read-only`, async () => {
      await open({ canRun: true, readOnly: true });
      for (let at = 0; at < BODIES.length; at++) {
        expect(current.editor(at).onEvalMath).toBeUndefined();
      }
      expect(current.evalMessages()).toHaveLength(0);
    });
  }
}
