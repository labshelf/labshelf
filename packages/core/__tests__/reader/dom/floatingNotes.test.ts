/** @jest-environment jsdom */
// Checks PDF note pins, floating creation and saving edits before closing or opening the full note, and that a param release sends
// the edited body (editNote) to the host before it posts the normal runCell.
import { TextEncoder as NodeTextEncoder } from "node:util";
import type { EditorPaperObjects } from "../../../src/qmd/dom/paperObjectPicker";
import { FloatingNotes } from "../../../src/reader/dom/floatingNotes";
import type { ReaderContext } from "../../../src/reader/dom/readerSession";
import type { ReaderNote } from "../../../src/reader/protocol/index";
import type { Annotation } from "../../../src/model/index";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

let floating: FloatingNotes;
const note = (anchor: string, body = ""): ReaderNote => ({ id: "n1", anchor, body, author: "Ana", created: "2026-10-30" });
function setup() {
  document.body.innerHTML = '<div id="viewer"><div class="page" data-page-number="4"><div class="textLayer"></div></div></div>';
  const post = jest.fn();
  const openFull = jest.fn();
  const ctx = { host: { post, on: jest.fn() }, eventBus: { on: jest.fn() }, container: document.getElementById("viewer"), pdfViewer: { currentPageNumber: 4 } } as unknown as ReaderContext;
  floating = new FloatingNotes(ctx, openFull);
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Paper note"]')!;
  return { post, openFull, dialog };
}
function edit(body: string): void {
  document.querySelector<HTMLButtonElement>(".rd-floating-note .qmd-editor-toggle")!.click();
  const input = document.querySelector<HTMLTextAreaElement>(".rd-floating-note textarea")!;
  input.value = body;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
afterEach(() => { floating?.close(); document.body.innerHTML = ""; });

it("creates a page note without a highlight and opens its floating editor", () => {
  const { post, dialog, openFull } = setup();
  floating.addPoint(4, 0.7, 0.3);
  expect(post).toHaveBeenCalledWith({ command: "addNote", anchor: "p4 point 0.7 0.3", body: "" });
  floating.show([note("p4 point 0.7 0.3")]);
  expect(dialog().hidden).toBe(false);
  expect(dialog().querySelector(".ProseMirror")).not.toBeNull();
  expect(document.querySelector(".rd-note-pin")).not.toBeNull();
  expect(document.querySelector(".rd-hl")).toBeNull();
  expect(openFull).not.toHaveBeenCalled();
});

it("keeps notes on highlights and opens them in the same floating editor", () => {
  const { post, dialog } = setup();
  floating.expectHighlight();
  floating.setAnnotations([{ id: "a1", pageNumber: 4, position: { x: 0.1, y: 0.2, width: 0.4, height: 0.03 } } as Annotation]);
  expect(post).toHaveBeenCalledWith({ command: "addNote", anchor: "hl:a1", body: "" });
  floating.show([note("hl:a1")]);
  expect(dialog().hidden).toBe(false);
  expect(document.querySelector(".rd-note-pin")).not.toBeNull();
});

it("reopens a stored page note from its pin", () => {
  const { dialog } = setup();
  floating.show([note("p4 point 0.7 0.3", "A saved note")]);
  expect(dialog().hidden).toBe(true);
  document.querySelector<HTMLButtonElement>(".rd-note-pin")!.click();
  expect(dialog().textContent).toContain("A saved note");
  expect(dialog().hidden).toBe(false);
});

it("numbers free and anchored markers per page without changing the notes or their editor", () => {
  const { post, dialog } = setup();
  floating.setAnnotations([{ id: "a1", pageNumber: 4, position: { x: 0.1, y: 0.2, width: 0.4, height: 0.03 } } as Annotation]);
  const free = note("p4 point 0.7 0.3", "Free note");
  const linked = { ...note("hl:a1", "Linked note"), id: "n2" };
  const others = [{ ...note("p2 point 0.2 0.3"), id: "n0" }, { ...note("p4 box 0.1 0.2 0.4 0.1"), id: "box" }];
  floating.show([linked, ...others, free]);
  const pin = (id: string) => document.querySelector<HTMLButtonElement>(`.rd-note-pin[data-note-id="${id}"]`)!;
  expect(pin("n1").textContent).toBe("01");
  expect(pin("n2").textContent).toBe("02");
  expect(pin("n2").getAttribute("aria-label")).toBe("Open note 02 on page 4");
  expect(pin("n2").querySelector("svg")).toBeNull();
  pin("n2").click();
  expect(dialog().textContent).toContain("Linked note");
  expect(pin("n2").getAttribute("aria-expanded")).toBe("true");
  floating.show([free, linked, ...others]);
  expect(pin("n2").textContent).toBe("02");
  expect(pin("n2").getAttribute("aria-expanded")).toBe("true");
  floating.close();
  expect(pin("n2").getAttribute("aria-expanded")).toBe("false");
  expect(post).not.toHaveBeenCalled();
});

it("flushes the last edit when closing before the editor debounce fires", () => {
  const { post, dialog } = setup();
  floating.addPoint(4, 0.7, 0.3);
  floating.show([note("p4 point 0.7 0.3")]);
  edit("Do not lose this edit");
  floating.close();
  expect(post).toHaveBeenCalledWith({ command: "editNote", id: "n1", body: "Do not lose this edit" });
  expect(dialog().hidden).toBe(true);
});

it("passes the latest text to the full note editor", () => {
  const { post, openFull } = setup();
  floating.addPoint(4, 0.7, 0.3);
  floating.show([note("p4 point 0.7 0.3")]);
  edit("Latest text");
  document.querySelector<HTMLButtonElement>(".rd-floating-note-full")!.click();
  expect(post).toHaveBeenCalledWith({ command: "editNote", id: "n1", body: "Latest text" });
  expect(openFull).toHaveBeenCalledWith("n1", "Latest text");
});


it("retains a draft when reopened before the host acknowledges its save", () => {
  const { dialog } = setup();
  floating.show([note("p4 point 0.7 0.3")]);
  document.querySelector<HTMLButtonElement>(".rd-note-pin")!.click();
  edit("Pending draft");
  floating.close();
  document.querySelector<HTMLButtonElement>(".rd-note-pin")!.click();
  expect(dialog().textContent).toContain("Pending draft");
  expect(dialog().querySelector(".rd-floating-note-status")!.textContent).toBe("Saving…");
  floating.show([note("p4 point 0.7 0.3", "Pending draft\n")]);
  expect(dialog().querySelector(".rd-floating-note-status")!.textContent).toBe("Saved");
});


it("keeps the editor open while its formatting menu is used", () => {
  const { dialog } = setup();
  floating.addPoint(4, 0.7, 0.3);
  floating.show([note("p4 point 0.7 0.3")]);
  const menu = document.body.appendChild(document.createElement("div"));
  menu.className = "ls-menu";
  menu.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  expect(dialog().hidden).toBe(false);
});


it("leaves a PDF text box to its own in-place editor: no pin and no popup", () => {
  const { dialog } = setup();
  floating.show([note("p4 box 0.1 0.2 0.4 0.1", "Text on the paper")]);
  expect(dialog().hidden).toBe(true);
  expect(document.querySelector(".rd-note-pin")).toBeNull();
});

it("runs a Python cell from the floating editor when the host can run cells", () => {
  const { post } = setup();
  floating.show([note("p4 point 0.7 0.3", "```{python}\n#| label: one\nprint(1)\n```")]);
  document.querySelector<HTMLButtonElement>(".rd-note-pin")!.click();
  expect(document.querySelector(".rd-floating-note .qmd-cell-run")).toBeNull();
  floating.setCanRunCells(true);
  document.querySelector<HTMLButtonElement>('.rd-floating-note [aria-label="Run cell"]')!.click();
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ command: "runCell", itemId: "n1", label: "one", code: "print(1)\n", language: "python" }));
});

it("shows an output the host writes while the caret is inside the editor", () => {
  const { dialog } = setup();
  const cell = "```{python}\n#| label: one\nprint(1)\n```\n";
  floating.show([note("p4 point 0.7 0.3", cell)]);
  document.querySelector<HTMLButtonElement>(".rd-note-pin")!.click();
  dialog().querySelector<HTMLElement>(".ProseMirror")!.focus();
  expect(dialog().contains(document.activeElement)).toBe(true);
  floating.show([note("p4 point 0.7 0.3", `${cell}\n::: {.labshelf-output cell="one" source="3f9a1c0b7d2e"}\nPrinted one\n:::\n`)]);
  expect(dialog().textContent).toContain("Printed one");
  expect(dialog().querySelector(".rd-floating-note-status")!.textContent).toBe("Saved");
});

it("keeps typing that the host has not acknowledged when an output arrives", () => {
  const { dialog } = setup();
  floating.show([note("p4 point 0.7 0.3", "Start")]);
  document.querySelector<HTMLButtonElement>(".rd-note-pin")!.click();
  edit("Start and more");
  floating.show([note("p4 point 0.7 0.3", "Start\n\n::: {.labshelf-output cell=\"one\" source=\"3f9a1c0b7d2e\"}\nPrinted one\n:::\n")]);
  expect(dialog().querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Start and more");
  expect(dialog().querySelector(".rd-floating-note-status")!.textContent).toBe("Saving…");
});

it("keeps the header to the title, the source and the expand and close icons, with the save status under the text", () => {
  const { dialog } = setup();
  floating.addPoint(2, 0.2, 0.3);
  floating.show([note("p2 point 0.2 0.3")]);
  const header = dialog().querySelector(".ls-note-popover-head")!;
  expect(header.querySelector(".rd-floating-note-status")).toBeNull();
  expect([...header.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual(["Page 2", "Open full note", "Close note"]);
  const status = dialog().querySelector(".qmd-editor-footer .rd-floating-note-status")!;
  expect(status.textContent).toBe("Saved");
});

it("shows the sidebar's simple note view: its editor look and line gutter, no note bar and no round '+'", () => {
  const { dialog } = setup();
  floating.show([note("p4 point 0.7 0.3", "Text")]);
  document.querySelector<HTMLButtonElement>(".rd-note-pin")!.click();
  expect(dialog().querySelector(".rd-note-editor.qmd-editor")).not.toBeNull();
  expect(dialog().querySelector(".qmd-gutter")).not.toBeNull();
  expect(dialog().querySelector(".qmd-note-bar")).toBeNull();
  expect(dialog().querySelector(".qmd-editor-insert")).toBeNull();
  expect(dialog().querySelector(".rd-note-editor")!.classList.contains("is-advanced")).toBe(false);
});

it("quotes the highlighted passage of a note on a highlight", () => {
  const { dialog } = setup();
  floating.setAnnotations([{ id: "a1", pageNumber: 4, content: "The quoted passage", color: "yellow", position: { x: 0.1, y: 0.2, width: 0.4, height: 0.03 } } as Annotation]);
  floating.show([note("hl:a1", "Text")]);
  document.querySelector<HTMLButtonElement>(".rd-note-pin")!.click();
  expect(dialog().querySelector(".rd-note-quote-text")!.textContent).toBe("The quoted passage");
  expect(dialog().querySelector(".rd-note-quote .rd-color-yellow")).not.toBeNull();
});

it("resizes from its corner within the limits and keeps the size for the next note", () => {
  const { dialog } = setup();
  floating.show([note("p4 point 0.7 0.3", "Text")]);
  document.querySelector<HTMLButtonElement>(".rd-note-pin")!.click();
  const handle = dialog().querySelector<HTMLElement>(".ls-note-popover-resize")!;
  handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0 }));
  handle.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 5000, clientY: 5000 }));
  handle.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
  expect(dialog().style.width).toBe("640px");
  expect(dialog().style.height).toBe(`${window.innerHeight * 0.8}px`);
  handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  expect(dialog().style.width).toBe("320px");
  floating.close();
  document.querySelector<HTMLButtonElement>(".rd-note-pin")!.click();
  expect(dialog().style.width).toBe("320px");
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const CELL = "```{python}\n#| label: calc\n#| param: n = slider(0, 10, 3)\nprint(n)\n```\n";
const releaseNote: ReaderNote = { id: "n1", anchor: "p4 point 0.7 0.3", body: `Intro\n\n${CELL}`, author: "Ana", created: "2026-10-30" };
let releaseFloating: FloatingNotes | undefined;

describe("param release in the floating note editor", () => {
  afterEach(() => { releaseFloating?.close(false); releaseFloating = undefined; document.body.innerHTML = ""; });
  it("A5 posts the edited body before the normal runCell in the floating note editor", async () => {
    document.body.innerHTML = '<div id="viewer"><div class="page" data-page-number="4"><div class="textLayer"></div></div></div>';
    const sent: Array<Record<string, unknown>> = [];
    const host = {
      on: jest.fn(),
      post: (m: Record<string, unknown>) => {
        sent.push(m);
        if (m["command"] === "runCell" && m["preview"]) {
          setTimeout(() => releaseFloating!.runs.showPreview(String(m["requestId"]), { status: "ok", language: "python", text: "7", durationMs: 5 }), 20);
        }
      },
    };
    const ctx = { host, eventBus: { on: jest.fn() }, container: document.getElementById("viewer"), pdfViewer: { currentPageNumber: 4 } } as unknown as ReaderContext;
    releaseFloating = new FloatingNotes(ctx, jest.fn());
    releaseFloating.show([releaseNote]);
    document.querySelector<HTMLButtonElement>(".rd-note-pin")!.click();
    releaseFloating.setCanRunCells(true);
    await wait(60);
    const range = document.querySelector<HTMLInputElement>('.rd-floating-note input[type="range"]')!;
    range.value = "7";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    range.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(600);
    const edit = sent.findIndex((m) => m["command"] === "editNote" && String(m["body"]).includes("slider(0, 10, 7)"));
    const run = sent.findIndex((m) => m["command"] === "runCell" && !m["preview"]);
    expect(run).toBeGreaterThanOrEqual(0);
    expect(sent[run]).toMatchObject({ itemId: "n1", label: "calc", params: { n: 7 } });
    expect(edit).toBeGreaterThanOrEqual(0);
    expect(edit).toBeLessThan(run);
  });
});

// From paper…: the editor gets paperObjects only when the host announced a paper-object port (init's hasPaperObjects).
const poMounted: Array<{ paperObjects?: EditorPaperObjects; files?: unknown }> = [];
jest.mock("../../../src/qmd/dom/qmdEditor", () => {
  const actual = jest.requireActual("../../../src/qmd/dom/qmdEditor");
  return { ...actual, mountQmdEditor: (root: HTMLElement, options: { paperObjects?: EditorPaperObjects; files?: unknown }) => { poMounted.push(options); return actual.mountQmdEditor(root, options); } };
});
const PO_NOTES: ReaderNote[] = [
  { id: "n1", anchor: "p4 point 0.7 0.3", body: "One", author: "Ana", created: "2026-10-30" },
  { id: "n2", anchor: "", body: "$$x$$ {#eq-2}", author: "Ana", created: "2026-10-30" },
];

function host() {
  const posted: unknown[] = [];
  const handlers = new Map<string, (message: unknown) => void>();
  return { posted, handlers, post: (message: unknown) => { posted.push(message); }, on: (type: string, handler: (message: unknown) => void) => { handlers.set(type, handler); } };
}

const eventBus = { on: jest.fn(), off: jest.fn(), dispatch: jest.fn() };

function poHost() {
  const posted: unknown[] = [];
  const handlers = new Map<string, (message: unknown) => void>();
  return { posted, handlers, post: (message: unknown) => { posted.push(message); }, on: (type: string, handler: (message: unknown) => void) => { handlers.set(type, handler); } };
}
const poEventBus = { on: jest.fn(), off: jest.fn(), dispatch: jest.fn() };

describe("floating note: From paper…", () => {
  beforeEach(() => { poMounted.length = 0; document.body.innerHTML = '<div id="viewer"><div class="page" data-page-number="4"><div class="textLayer"></div></div></div>'; });
  function open(flag: boolean) {
    const h = poHost();
    const ctx = { host: h, eventBus: poEventBus, boot: { paperId: "paper-7" }, container: document.getElementById("viewer"), pdfViewer: { currentPageNumber: 4 } } as unknown as ReaderContext;
    const floating = new FloatingNotes(ctx, jest.fn());
    floating.setPaperObjects(flag);
    floating.addPoint(4, 0.7, 0.3);
    floating.show(PO_NOTES);
    return floating;
  }

  test("passes paperObjects with the reader's paper when the flag is on", () => {
    const floating = open(true);
    const options = poMounted.at(-1)!;
    expect(options.files).toBeDefined();
    expect(options.paperObjects?.defaultPaperId).toBe("paper-7");
    expect(options.paperObjects?.otherBodies?.()).toEqual(["$$x$$ {#eq-2}"]);
    floating.close();
  });

  test("passes no paperObjects when the flag is off", () => {
    const floating = open(false);
    expect(poMounted.length).toBeGreaterThan(0);
    expect(poMounted.at(-1)!.paperObjects).toBeUndefined();
    floating.close();
  });
});
