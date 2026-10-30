/** @jest-environment jsdom */
// Tests the reader's Notes tab and text-box layer with the real editor: Run exists only after setCanRunCells(true), pressing Run
// posts a `runCell` command through ctx.host, and showCellState shows a matching state while an unknown request is ignored.
//
// Assumptions about what the spec leaves open: the Run and Cancel controls are <button>s whose text, aria-label or title match
// /run/i and /cancel/i; the NotesTab lists every note with its editor under the default filter; a text box shows its editor after a
// click on the first element inside `.rd-note-layer` (the box) if Run is not visible yet; the layer draws on `#viewer .page` when
// pdf.js fires `textlayerrendered`; NotesTab is built as (host, goToPage, currentPage, eventBus), NoteBoxLayer takes the ctx (`{ host, eventBus }`) which also works as
// a bare host (it has `post`), so either 7.4 constructor shape is served.
import { TextEncoder as NodeTextEncoder } from "node:util";
import { NotesTab } from "../../../src/reader/dom/notesTab";
import { NoteBoxLayer } from "../../../src/reader/dom/noteBoxes";
import type { ReaderNote } from "../../../src/reader/protocol/messages";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

const BODY = "Intro\n\n```{python}\n#| label: calc\nprint(1)\n```\n";
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const text = (b: Element) => `${b.textContent ?? ""} ${b.getAttribute("aria-label") ?? ""} ${b.getAttribute("title") ?? ""}`;
const button = (root: ParentNode, re: RegExp) => [...root.querySelectorAll("button")].find((b) => re.test(text(b)));
const note: ReaderNote = { id: "n1", anchor: "p2 box 0.1 0.2 0.3 0.4", body: BODY, created: "2026-10-01T00:00:00.000Z", author: "Ana" } as ReaderNote;

type Cell = "running" | "done" | "error" | "cancelled" | "missing-python";
interface Subject { root: HTMLElement; setCanRunCells(on: boolean): void; showCellState(id: string, state: Cell): void; open(): Promise<void>; show(): void }

function makeCtx() {
  const sent: Array<Record<string, unknown>> = [];
  const handlers = new Map<string, Array<(e?: unknown) => void>>();
  const post = (m: Record<string, unknown>) => { sent.push(m); };
  const eventBus = {
    on: (name: string, fn: (e?: unknown) => void) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
    off: () => undefined,
    dispatch: (name: string, e?: unknown) => (handlers.get(name) ?? []).forEach((fn) => fn(e)),
  };
  const host = { post };
  const ctx = { host, eventBus, post } as never;
  const runs = () => sent.filter((m) => m["command"] === "runCell");
  return { ctx, host, sent, runs, eventBus };
}

const KINDS: Array<{ name: string; make: () => { subject: Subject; c: ReturnType<typeof makeCtx> } }> = [
  {
    name: "Notes tab",
    make: () => {
      const c = makeCtx();
      document.body.replaceChildren();
      const tab = new NotesTab(c.host as never, jest.fn(), () => 1, c.eventBus as never);
      document.body.append(tab.el);
      const subject: Subject = {
        root: tab.el,
        setCanRunCells: (on) => tab.setCanRunCells(on),
        showCellState: (id, state) => tab.showCellState(id, state),
        show: () => tab.show([note]),
        open: async () => { tab.reveal(note.id); await settle(); },
      };
      return { subject, c };
    },
  },
  {
    name: "text boxes",
    make: () => {
      const c = makeCtx();
      document.body.innerHTML = `<div id="viewer"><div class="page" data-page-number="2"><div class="canvasWrapper"></div><div class="textLayer"></div></div></div>`;
      const layer = new NoteBoxLayer(c.ctx);
      const page = document.querySelector<HTMLElement>(".page")!;
      const subject: Subject = {
        root: page,
        setCanRunCells: (on) => layer.setCanRunCells(on),
        showCellState: (id, state) => layer.showCellState(id, state),
        show: () => { layer.show([note]); c.eventBus.dispatch("textlayerrendered", { pageNumber: 2 }); },
        open: async () => {
          await settle();
          if (!button(page, /run/i)) { (page.querySelector(".rd-note-layer")?.firstElementChild as HTMLElement | null)?.click(); }
          await settle();
        },
      };
      return { subject, c };
    },
  },
];

async function ready(kind: (typeof KINDS)[number], canRun: boolean, order: "flag-first" | "notes-first" = "flag-first") {
  const { subject, c } = kind.make();
  if (order === "flag-first") { subject.setCanRunCells(canRun); subject.show(); } else { subject.show(); subject.setCanRunCells(canRun); }
  await subject.open();
  return { s: subject, c };
}

describe.each(KINDS)("reader $name run cells", (kind) => {
  it(`12.5b shows no Run button in the ${kind.name} when canRunCells is false`, async () => {
    const { s } = await ready(kind, false);
    expect(button(s.root, /run/i)).toBeUndefined();
  });

  it(`12.5b shows no Run button in the ${kind.name} when setCanRunCells was never called`, async () => {
    const { subject, c } = kind.make();
    subject.show();
    await subject.open();
    expect(button(subject.root, /run/i)).toBeUndefined();
    expect(c.runs()).toEqual([]);
  });

  it.each(["flag-first", "notes-first"] as const)(`12.5b shows a Run button in the ${kind.name} once canRunCells is true (%s)`, async (order) => {
    const { s, c } = await ready(kind, true, order);
    expect(button(s.root, /run/i)).toBeDefined();
    expect(c.runs()).toEqual([]);
  });

  it(`12.5b posts a runCell command with the item id, label, code and a request id on Run in the ${kind.name}`, async () => {
    const { s, c } = await ready(kind, true);
    button(s.root, /run/i)!.click();
    await settle();
    expect(c.runs()).toHaveLength(1);
    expect(c.runs()[0]).toMatchObject({ command: "runCell", itemId: "n1", label: "calc" });
    expect(String(c.runs()[0]!["code"])).toContain("print(1)");
    expect(String(c.runs()[0]!["requestId"]).length).toBeGreaterThan(0);
  });

  it(`12.5b shows Cancel in the ${kind.name} for a matching running state and posts cancelCell with the request id`, async () => {
    const { s, c } = await ready(kind, true);
    button(s.root, /run/i)!.click();
    await settle();
    const requestId = String(c.runs()[0]!["requestId"]);
    s.showCellState(requestId, "running");
    await settle();
    const cancel = button(s.root, /cancel/i);
    expect(cancel).toBeDefined();
    cancel!.click();
    expect(c.sent).toContainEqual({ command: "cancelCell", requestId });
  });

  it.each(["done", "error", "cancelled", "missing-python"] as const)(`12.5b drops the Cancel button in the ${kind.name} on a matching %s state`, async (state) => {
    const { s, c } = await ready(kind, true);
    button(s.root, /run/i)!.click();
    await settle();
    const requestId = String(c.runs()[0]!["requestId"]);
    s.showCellState(requestId, "running");
    await settle();
    expect(button(s.root, /cancel/i)).toBeDefined();
    s.showCellState(requestId, state);
    await settle();
    expect(button(s.root, /cancel/i)).toBeUndefined();
  });

  it(`12.5b mentions Python in the ${kind.name} on a missing-python state`, async () => {
    const { s, c } = await ready(kind, true);
    button(s.root, /run/i)!.click();
    await settle();
    s.showCellState(String(c.runs()[0]!["requestId"]), "missing-python");
    await settle();
    expect(s.root.textContent).toMatch(/python/i);
  });

  it(`12.5b ignores a cellState for an unknown request in the ${kind.name}`, async () => {
    const { s } = await ready(kind, true);
    button(s.root, /run/i)!.click();
    await settle();
    const before = s.root.textContent;
    s.showCellState("someone-else", "running");
    await settle();
    expect(button(s.root, /cancel/i)).toBeUndefined();
    expect(s.root.textContent).toBe(before);
  });
});


describe("compact note browsing", () => {
  function setup() {
    document.body.replaceChildren();
    const c = makeCtx();
    const tab = new NotesTab(c.host as never, jest.fn(), () => 2, c.eventBus as never);
    document.body.append(tab.el);
    const second = { ...note, id: "n2", anchor: "p3 point 0.4 0.2", body: "# A second thought\n\nA short explanation.\n" };
    tab.show([note, second]);
    return { tab, c, second };
  }

  it("shows previews instead of mounting an editor for every note", () => {
    const { tab } = setup();
    expect(tab.el.querySelectorAll(".rd-note-preview")).toHaveLength(2);
    expect(tab.el.querySelector(".ProseMirror")).toBeNull();
    expect(tab.el.textContent).toContain("A second thought");
    expect(tab.el.textContent).toContain("Page 3");
  });

  it("opens one editor and returns to the same search", () => {
    const { tab } = setup();
    const search = tab.el.querySelector<HTMLInputElement>("input[type=search]")!;
    search.value = "second";
    search.dispatchEvent(new Event("input"));
    expect(tab.el.querySelectorAll(".rd-note-preview")).toHaveLength(1);
    tab.el.querySelector<HTMLButtonElement>(".rd-note-preview")!.click();
    expect(tab.el.querySelectorAll(".ProseMirror")).toHaveLength(1);
    expect(tab.el.querySelector<HTMLElement>(".rd-notes-list")!.hidden).toBe(true);
    tab.el.querySelector<HTMLButtonElement>(".rd-notes-back")!.click();
    expect(tab.el.querySelector(".ProseMirror")).toBeNull();
    expect(search.value).toBe("second");
  });

  it("sends the last edit before changing notes", () => {
    const { tab, c } = setup();
    tab.reveal(note.id);
    tab.el.querySelector<HTMLButtonElement>(".qmd-editor-toggle")!.click();
    const input = tab.el.querySelector<HTMLTextAreaElement>("textarea")!;
    input.value = "Latest edit";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    tab.reveal("n2");
    expect(c.sent).toContainEqual({ command: "editNote", id: "n1", body: "Latest edit" });
    expect(tab.el.querySelectorAll(".ProseMirror")).toHaveLength(1);
    expect(tab.el.querySelector(".ProseMirror")!.textContent).toContain("A second thought");
    tab.onHide();
  });
  it("keeps unsent typing when a host update arrives", () => {
    const { tab, c, second } = setup();
    tab.reveal(note.id);
    tab.el.querySelector<HTMLButtonElement>(".qmd-editor-toggle")!.click();
    const input = tab.el.querySelector<HTMLTextAreaElement>("textarea")!;
    input.value = "Unsent typing";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    tab.show([note, second]);
    expect(input.value).toBe("Unsent typing");
    tab.onHide();
    expect(c.sent).toContainEqual({ command: "editNote", id: "n1", body: "Unsent typing" });
  });

  it("gives math-only and code-only notes readable previews", () => {
    const { tab } = setup();
    tab.show([{ ...note, body: "$$\nx^2 + y^2\n$$\n" }, { ...note, id: "n2", body: "```python\nprint(1)\n```\n" }]);
    expect(tab.el.querySelectorAll(".rd-note-preview-title")[0]!.textContent).toBe("Equation note");
    expect(tab.el.querySelectorAll(".rd-note-preview-title")[1]!.textContent).toBe("Code note");
  });

});


it("delegates PDF text-box editing to the floating editor", () => {
  document.body.innerHTML = '<div id="viewer"><div class="page" data-page-number="2"><div class="textLayer"></div></div></div>';
  const c = makeCtx();
  const layer = new NoteBoxLayer(c.ctx);
  layer.onEdit = jest.fn();
  layer.show([note]);
  document.querySelector<HTMLElement>(".rd-note-box")!.click();
  expect(layer.onEdit).toHaveBeenCalledWith("n1");
  expect(document.querySelector(".rd-note-box .ProseMirror")!.getAttribute("contenteditable")).toBe("false");
});
