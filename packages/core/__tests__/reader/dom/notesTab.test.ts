/** @jest-environment jsdom */
// Tests the reader's Notes tab and text-box layer with the real editor: Run exists only after setCanRunCells(true), pressing Run
// posts a `runCell` command through ctx.host, and showCellState shows a matching state while an unknown request is ignored.
//
// Assumptions about what the spec leaves open: the Run and Cancel controls are <button>s whose text, aria-label or title match
// /run/i and /cancel/i; the NotesTab lists every note with its editor under the default filter; a text box shows its editor after a
// click on the first element inside `.rd-note-layer` (the box) if Run is not visible yet; the layer draws on `#viewer .page` when
// pdf.js fires `textlayerrendered`; NotesTab is built as (host, goToPage, currentPage, eventBus), NoteBoxLayer takes the ctx (`{ host, eventBus }`) which also works as
// a bare host (it has `post`), so either 7.4 constructor shape is served.
//
// The param release cases use a fake host that stores the item body like the real one: `editNote` replaces the body, a normal `runCell`
// writes its output into the stored body (with the real writeCellOutput) after `runMs` and pushes it, a preview is answered after 20 ms.
import { TextEncoder as NodeTextEncoder } from "node:util";
import { NotesTab } from "../../../src/reader/dom/notesTab";
import { NoteBoxLayer } from "../../../src/reader/dom/noteBoxes";
import type { ReaderNote } from "../../../src/reader/protocol/messages";
import { writeCellOutput } from "../../../src/qmd/compute/writeCellOutput";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

const BODY = "Intro\n\n```{python}\n#| label: calc\nprint(1)\n```\n";
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const text = (b: Element) => `${b.textContent ?? ""} ${b.getAttribute("aria-label") ?? ""} ${b.getAttribute("title") ?? ""}`;
const button = (root: ParentNode, re: RegExp) => [...root.querySelectorAll("button")].find((b) => re.test(text(b)));
const note: ReaderNote = { id: "n1", anchor: "p2 box 0.1 0.2 0.3 0.4", body: BODY, created: "2026-10-01T00:00:00.000Z", author: "Ana" } as ReaderNote;

type Cell = "running" | "done" | "error" | "cancelled" | "missing";
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
  const host = { post, on: jest.fn() };
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
  it(`12.5b shows no enabled Run button in the ${kind.name} when canRunCells is false`, async () => {
    const { s } = await ready(kind, false);
    expect(s.root.querySelector("button:not([disabled])[aria-label='Run all']")).toBeNull();
  });

  it(`12.5b shows no enabled Run button in the ${kind.name} when setCanRunCells was never called`, async () => {
    const { subject, c } = kind.make();
    subject.show();
    await subject.open();
    expect(subject.root.querySelector("button:not([disabled])[aria-label='Run all']")).toBeNull();
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
    expect(c.runs()[0]).toMatchObject({ command: "runCell", itemId: "n1", label: "calc", language: "python" });
    expect(c.runs()[0]).not.toHaveProperty("noteKey");
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

  it.each(["done", "error", "cancelled", "missing"] as const)(`12.5b drops the Cancel button in the ${kind.name} on a matching %s state`, async (state) => {
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
    s.showCellState(String(c.runs()[0]!["requestId"]), "missing");
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
    expect(tab.el.querySelectorAll(".rd-note-preview-title")[0]!.textContent).toBe("x^2 + y^2");
    expect(tab.el.querySelectorAll(".rd-note-preview-title")[1]!.textContent).toBe("print(1)");
  });

  it("falls back to a kind title for an empty code note and strips inline math delimiters", () => {
    const { tab } = setup();
    tab.show([{ ...note, body: "```python\n```\n" }, { ...note, id: "n2", body: "Scale by $\\sqrt{d_k}$ here\n" }]);
    const titles = [...tab.el.querySelectorAll(".rd-note-preview-title")].map((el) => el.textContent);
    expect(titles).toEqual(["Code note", "Scale by √d_k here"]);
  });

  it("shows the highlighted passage in the list and a page chip in the editor", () => {
    const { tab, second } = setup();
    tab.setAnnotations([{ id: "a1", pageNumber: 4, color: "green", content: "The quoted passage", type: "highlight" } as never]);
    tab.show([{ ...second, id: "n3", anchor: "hl:a1" }]);
    expect(tab.el.querySelector(".rd-note-preview-quote")!.textContent).toBe("The quoted passage");
    expect(tab.el.querySelector(".rd-note-accent.rd-color-green")).not.toBeNull();
    tab.reveal("n3");
    expect(tab.el.querySelector(".rd-note-source")!.textContent).toBe("Page 4");
    expect(tab.el.querySelector(".rd-notes-back")!.getAttribute("aria-label")).toBe("All notes");
    expect(tab.el.querySelector(".rd-note-quote")!.textContent).toContain("The quoted passage");
    tab.onHide();
  });

});


it("an open note's nav holds only back, Note and its page; deleting is a confirmed trash icon on the list row", async () => {
  const c = makeCtx();
  document.body.replaceChildren();
  const tab = new NotesTab(c.host as never, jest.fn(), () => 1, c.eventBus as never);
  document.body.append(tab.el);
  tab.show([note]);
  const trash = tab.el.querySelector<HTMLButtonElement>(".rd-note-row .rd-note-delete")!;
  trash.click();
  expect(c.sent.some((m) => m["command"] === "removeNote")).toBe(false);
  expect(trash.getAttribute("aria-label")).toBe("Click again to delete this note");
  trash.click();
  expect(c.sent).toContainEqual({ command: "removeNote", id: "n1" });
  tab.reveal(note.id);
  await settle();
  const nav = tab.el.querySelector(".rd-notes-editor-nav")!;
  expect(nav.querySelector(".rd-note-delete, svg:not(.rd-notes-back svg, .qmd-note-bar svg)")).toBeNull();
  expect([...nav.children].filter((child) => !child.matches(".qmd-note-bar, .qmd-outline-panel")).map((child) => child.textContent)).toEqual(["", "Note", "Page 2"]);
  expect(tab.el.querySelector(".qmd-editor-footer .rd-note-save-status")).not.toBeNull();
  tab.onHide();
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const CELL = "```{python}\n#| label: calc\n#| param: n = slider(0, 10, 3)\nprint(n)\n```\n";
const releaseNote: ReaderNote = { id: "n1", anchor: "p2 box 0.1 0.2 0.3 0.4", body: `Intro\n\n${CELL}`, created: "2026-10-01T00:00:00.000Z", author: "Ana" } as ReaderNote;

/** The editor's output views showing a stored output (a drag preview result is not one). */
const storedOutputs = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(".qmd-output:not(.is-preview)")];

/** Mounts the tab on the fake host, drags the slider to 7 and releases it, then waits `settleMs`. */
async function releaseSlider(runMs: number, settleMs: number) {
  let stored = releaseNote.body;
  const sent: Array<Record<string, unknown>> = [];
  const handlers = new Map<string, Array<(e?: unknown) => void>>();
  const eventBus = { on: (name: string, fn: (e?: unknown) => void) => handlers.set(name, [...(handlers.get(name) ?? []), fn]), off: () => undefined, dispatch: () => undefined };
  document.body.replaceChildren();
  const host = { post: (_m: Record<string, unknown>) => undefined, on: () => undefined } as { post(m: Record<string, unknown>): void; on(): void };
  const tab = new NotesTab(host as never, jest.fn(), () => 1, eventBus as never);
  document.body.append(tab.el);
  const push = () => tab.show([{ ...releaseNote, body: stored }]);
  host.post = (m) => {
    sent.push(m);
    if (m["command"] === "runCell" && m["preview"]) {
      setTimeout(() => tab.runs.showPreview(String(m["requestId"]), { status: "ok", language: "python", text: "7", durationMs: 5 }), 20);
    }
    if (m["command"] === "runCell" && !m["preview"]) {
      setTimeout(() => tab.showCellState(String(m["requestId"]), "running"), 0);
      setTimeout(() => {
        void writeCellOutput(stored, "calc", { status: "ok", language: "python", text: "7", durationMs: 5 }, { ran: "2026-10-31T00:00:00.000Z", params: m["params"] as Record<string, number> }).then((next) => {
          stored = next; push(); tab.showCellState(String(m["requestId"]), "done");
        });
      }, runMs);
    }
    if (m["command"] === "editNote") { stored = String(m["body"]); push(); }
  };
  tab.setCanRunCells(true);
  push();
  tab.reveal("n1");
  await wait(60);
  const range = tab.el.querySelector<HTMLInputElement>('input[type="range"]')!;
  range.value = "7";
  range.dispatchEvent(new Event("input", { bubbles: true }));
  range.dispatchEvent(new Event("change", { bubbles: true }));
  await wait(settleMs);
  return { tab, sent, stored: () => stored, normalRuns: () => sent.filter((m) => m["command"] === "runCell" && !m["preview"]) };
}

// A param release writes the new value into the cell's param line (an editor change, saved after the editor and save debounces) and
// runs the cell at once. A run that ends before that save lands must keep its output: the saved draft may not overwrite the host's body.
describe("param release in the Notes tab", () => {
  it("A1 keeps the output of a param release run that ends before the edited param line is saved", async () => {
    const t = await releaseSlider(50, 1300);
    expect(t.normalRuns()).toHaveLength(1);
    expect(t.stored()).toContain("slider(0, 10, 7)");
    expect(t.stored()).toContain('params="n=7"');
    t.tab.onHide();
  });

  it("A2 shows the new output in the editor without the Out-of-date caption", async () => {
    const t = await releaseSlider(50, 1300);
    const outputs = storedOutputs(t.tab.el);
    expect(outputs.length).toBeGreaterThan(0);
    expect(outputs.some((o) => o.classList.contains("is-out-of-date"))).toBe(false);
    expect(t.tab.el.textContent).not.toMatch(/out of date/i);
    expect(outputs.map((o) => o.textContent).join(" ")).toContain("7");
    expect(t.stored()).toContain("labshelf-output");
    t.tab.onHide();
  });

  it("A3 posts exactly one normal runCell for a release, with the released values", async () => {
    const t = await releaseSlider(50, 300);
    expect(t.normalRuns()).toHaveLength(1);
    expect(t.normalRuns()[0]).toMatchObject({ command: "runCell", itemId: "n1", label: "calc", language: "python", params: { n: 7 } });
    expect(String(t.normalRuns()[0]!["code"])).toContain("print(n)");
    expect(t.sent.filter((m) => m["command"] === "runCell" && m["preview"]).length).toBeGreaterThanOrEqual(1);
    t.tab.onHide();
  });

  it("A4 keeps the param line and the output when the run is slower than the save delay", async () => {
    const t = await releaseSlider(900, 2100);
    expect(t.normalRuns()).toHaveLength(1);
    expect(t.stored()).toContain("slider(0, 10, 7)");
    expect(t.stored()).toContain('params="n=7"');
    const outputs = storedOutputs(t.tab.el);
    expect(outputs.length).toBeGreaterThan(0);
    expect(outputs.some((o) => o.classList.contains("is-out-of-date"))).toBe(false);
    expect(t.tab.el.textContent).not.toMatch(/out of date/i);
    t.tab.onHide();
  });

  it("A5 posts the edited body before the normal runCell in the Notes tab", async () => {
    const t = await releaseSlider(50, 700);
    const at = (pred: (m: Record<string, unknown>) => boolean) => t.sent.findIndex(pred);
    const edit = at((m) => m["command"] === "editNote" && String(m["body"]).includes("slider(0, 10, 7)"));
    const run = at((m) => m["command"] === "runCell" && !m["preview"]);
    expect(run).toBeGreaterThanOrEqual(0);
    expect(edit).toBeGreaterThanOrEqual(0);
    expect(edit).toBeLessThan(run);
    t.tab.onHide();
  });
});
