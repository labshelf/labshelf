/** @jest-environment jsdom */
// Checks text boxes edited in place on the page: click and Escape, empty boxes removed, the width-only resize with its minimum,
// delete with a confirming second press, the colour, and that a box offers text and math only.
import { TextEncoder as NodeTextEncoder } from "node:util";
import { NoteBoxLayer } from "../../../src/reader/dom/noteBoxes";
import type { ReaderContext } from "../../../src/reader/dom/readerSession";
import type { ReaderNote } from "../../../src/reader/protocol/index";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

const ANCHOR = "p4 box 0.1 0.2 0.4 0.1";
const note = (body: string, extra: Partial<ReaderNote> = {}): ReaderNote => ({ id: "n1", anchor: ANCHOR, body, author: "Ana", created: "2026-10-30", ...extra });

function setup() {
  document.body.innerHTML = '<div id="viewer"><div class="page" data-page-number="4"><div class="textLayer"></div></div></div><button id="outside"></button>';
  const page = document.querySelector<HTMLElement>(".page")!;
  // A 600 by 800 page at the top-left of the viewport; jsdom has no layout of its own.
  Object.defineProperty(page, "clientWidth", { value: 600 });
  Object.defineProperty(page, "clientHeight", { value: 800 });
  const post = jest.fn();
  const ctx = { host: { post, on: jest.fn() }, eventBus: { on: jest.fn() } } as unknown as ReaderContext;
  const layer = new NoteBoxLayer(ctx);
  const openFull = jest.fn();
  layer.onOpenFull = openFull;
  const box = () => document.querySelector<HTMLElement>(".rd-note-box")!;
  return { post, layer, box, openFull };
}

function press(target: Element, at: { x: number; y: number }, to = at): void {
  target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: at.x, clientY: at.y }));
  window.dispatchEvent(new MouseEvent("pointermove", { clientX: to.x, clientY: to.y }));
  window.dispatchEvent(new MouseEvent("pointerup", { clientX: to.x, clientY: to.y }));
}

function type(box: HTMLElement, body: string): void {
  box.querySelector<HTMLButtonElement>(".qmd-editor-toggle")!.click();
  const input = box.querySelector<HTMLTextAreaElement>("textarea")!;
  input.value = body;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const editable = (box: HTMLElement): boolean => box.querySelector(".ProseMirror")!.getAttribute("contenteditable") === "true";
const posted = (post: jest.Mock, command: string): unknown[] => post.mock.calls.map(([m]) => m).filter((m: { command: string }) => m.command === command);

afterEach(() => { document.body.innerHTML = ""; });

it("edits a box in place on click, saves on Escape and opens no floating popup", () => {
  const { post, layer, box } = setup();
  layer.show([note("Text on the paper")]);
  expect(editable(box())).toBe(false);
  press(box().querySelector(".rd-note-box-content")!, { x: 100, y: 200 });
  expect(box().classList.contains("rd-note-box-editing")).toBe(true);
  expect(editable(box())).toBe(true);
  expect(document.querySelector(".rd-floating-note")).toBeNull();
  type(box(), "Edited on the paper");
  box().querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(posted(post, "editNote")).toContainEqual({ command: "editNote", id: "n1", body: "Edited on the paper" });
  expect(box().classList.contains("rd-note-box-editing")).toBe(false);
  expect(editable(box())).toBe(false);
  expect(document.activeElement).toBe(box());
});

it("keeps unacknowledged text over an older stored body while editing", () => {
  const { layer, box } = setup();
  layer.show([note("Old")]);
  box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  type(box(), "New text");
  layer.show([note("Old")]);
  expect(box().querySelector("textarea")!.value).toBe("New text");
});

it("opens a box just drawn in editing mode and deletes it when left empty", () => {
  const { post, layer, box } = setup();
  layer.expectBox(ANCHOR);
  layer.show([note("")]);
  expect(editable(box())).toBe(true);
  document.getElementById("outside")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  expect(posted(post, "removeNote")).toEqual([{ command: "removeNote", id: "n1" }]);
  expect(document.querySelector(".rd-note-box")).toBeNull();
  // The host's list may still hold it until the removal lands; it is not drawn again.
  layer.show([note("")]);
  expect(document.querySelector(".rd-note-box")).toBeNull();
});

it("offers no cells or figures in a box, while a stored cell still renders", () => {
  const { layer, box } = setup();
  layer.expectBox(ANCHOR);
  layer.show([note("")]);
  expect(box().querySelector(".qmd-empty-choices")).toBeNull();
  expect(box().querySelector(".qmd-insert-gap, .qmd-editor-insert")).toBeNull();
  expect(box().querySelector(".qmd-editor-placeholder")?.getAttribute("data-placeholder")).toBe("Type…");
  layer.show([note("```{python}\nprint(1)\n```\n")]);
  expect(box().querySelector(".qmd-cell")).not.toBeNull();
});

it("shows no placeholder on an empty box that is not being edited", () => {
  const { layer, box } = setup();
  layer.show([note("")]);
  expect(box().querySelector(".qmd-editor-placeholder")?.getAttribute("data-placeholder") ?? "").toBe("");
});

it("resizes only the width and never below the minimum, so a box can be grown again", () => {
  const { post, layer, box } = setup();
  layer.show([note("Text")]);
  const handle = box().querySelector(".rd-note-box-resize")!;
  press(handle, { x: 300, y: 200 }, { x: -400, y: 500 });
  // Six ems of the 12 px fallback font on a 600 px page: 0.12; the height and the top stay.
  expect(posted(post, "moveNote")).toEqual([{ command: "moveNote", id: "n1", anchor: "p4 box 0.1 0.2 0.12 0.1" }]);
  press(handle, { x: 132, y: 200 }, { x: 252, y: 260 });
  expect(posted(post, "moveNote")[1]).toEqual({ command: "moveNote", id: "n1", anchor: "p4 box 0.1 0.2 0.32 0.1" });
});

it("grows a collapsed stored box to the minimum when it is moved", () => {
  const { post, layer, box } = setup();
  layer.show([note("Text", { anchor: "p4 box 0.5 0.5 0.0001 0.0001" })]);
  press(box(), { x: 300, y: 400 }, { x: 360, y: 400 });
  const [moved] = posted(post, "moveNote") as { anchor: string }[];
  const [, x, y, w, h] = /^p4 box (\S+) (\S+) (\S+) (\S+)$/.exec(moved!.anchor)!.map(Number);
  expect([x, y, w]).toEqual([0.6, 0.5, 0.12]);
  // One line of the 12 px fallback font on an 800 px page.
  expect(h).toBeCloseTo((1.65 * 12) / 800, 3);
});

it("deletes a box with text only on a second Delete, and an empty one at once", () => {
  const { post, layer, box } = setup();
  layer.show([note("Text")]);
  box().focus();
  box().dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  expect(posted(post, "removeNote")).toEqual([]);
  expect(box().querySelector(".rd-note-box-delete")!.getAttribute("aria-label")).toBe("Click again to delete this note");
  box().dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
  expect(posted(post, "removeNote")).toEqual([{ command: "removeNote", id: "n1" }]);
});

it("tints a box with the chosen colour and sends it to the host", () => {
  const { post, layer, box } = setup();
  layer.show([note("Text", { color: "blue" })]);
  expect(box().classList.contains("rd-color-blue")).toBe(true);
  box().querySelector<HTMLButtonElement>(".rd-note-box-palette")!.click();
  box().querySelector<HTMLButtonElement>('[aria-label="Colour green"]')!.click();
  expect(posted(post, "colorNote")).toEqual([{ command: "colorNote", id: "n1", color: "green" }]);
  expect(box().classList.contains("rd-color-green")).toBe(true);
  expect(box().classList.contains("rd-color-blue")).toBe(false);
  box().querySelector<HTMLButtonElement>(".rd-note-box-palette")!.click();
  box().querySelector<HTMLButtonElement>('[aria-label="No colour"]')!.click();
  expect(posted(post, "colorNote")[1]).toEqual({ command: "colorNote", id: "n1", color: "" });
  expect(box().classList.contains("rd-note-box-tinted")).toBe(false);
});

it("opens the box's note in the sidebar with the text it shows", () => {
  const { layer, box, openFull } = setup();
  layer.show([note("Text")]);
  box().querySelector<HTMLButtonElement>(".rd-note-box-open")!.click();
  expect(openFull).toHaveBeenCalledWith("n1", "Text");
});
