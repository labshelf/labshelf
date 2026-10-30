/** @jest-environment jsdom */
// Checks PDF note pins, floating creation and saving edits before closing or opening the full note.
import { FloatingNotes } from "../../../src/reader/dom/floatingNotes";
import type { ReaderContext } from "../../../src/reader/dom/readerSession";
import type { ReaderNote } from "../../../src/reader/protocol/index";
import type { Annotation } from "../../../src/model/index";

let floating: FloatingNotes;
const note = (anchor: string, body = ""): ReaderNote => ({ id: "n1", anchor, body, author: "Ana", created: "2026-10-30" });
function setup() {
  document.body.innerHTML = '<div id="viewer"><div class="page" data-page-number="4"><div class="textLayer"></div></div></div>';
  const post = jest.fn();
  const openFull = jest.fn();
  const ctx = { host: { post }, eventBus: { on: jest.fn() }, container: document.getElementById("viewer"), pdfViewer: { currentPageNumber: 4 } } as unknown as ReaderContext;
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


it("opens the floating editor for a PDF text box without creating a second pin", () => {
  const { dialog } = setup();
  floating.show([note("p4 box 0.1 0.2 0.4 0.1", "Text on the paper")]);
  floating.openNote("n1");
  expect(dialog().hidden).toBe(false);
  expect(dialog().textContent).toContain("Text on the paper");
  expect(document.querySelector(".rd-note-pin")).toBeNull();
});

it("runs a Python cell from the floating editor when the host can run cells", () => {
  const { post } = setup();
  floating.show([note("p4 point 0.7 0.3", "```{python}\n#| label: one\nprint(1)\n```")]);
  document.querySelector<HTMLButtonElement>(".rd-note-pin")!.click();
  expect(document.querySelector(".rd-floating-note .qmd-cell-run")).toBeNull();
  floating.setCanRunCells(true);
  document.querySelector<HTMLButtonElement>('.rd-floating-note [aria-label="Run cell"]')!.click();
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ command: "runCell", itemId: "n1", label: "one", code: "print(1)\n" }));
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
