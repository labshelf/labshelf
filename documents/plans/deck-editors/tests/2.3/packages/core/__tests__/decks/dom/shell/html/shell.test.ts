/** @jest-environment jsdom */
/**
 * Spec 2.3: HTML decks run in the shell. openDeckWorkspace renders the shell's header, insert bar, zoom bar and status around the bare
 * editor, handles the shell key map, and openDeckEditor on its own is the bare editor with no toolbar, status line or problems list.
 * jsdom has no layout (the stage clientWidth is 0, so a fitted editor has scale 1) and does not load srcdoc frames, so a
 * MutationObserver loads each srcdoc into its frame. Mod is held as Ctrl and Meta together so the platform does not matter.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { applyDeckEdit } from "../../../../../src/decks/deckEdit";
import { parseDeck } from "../../../../../src/decks/deckParse";
import { openDeckEditor, openDeckWorkspace, type DeckEditorChange, type DeckWorkspaceController, type DeckWorkspaceOptions } from "../../../../../src/decks/dom/openDeckEditor";

const THEME = ":root { --deck-bg: #ffffff; --deck-fg: #1a1a1a; }\n";
const HEAD = '<head>\n<meta charset="utf-8">\n<title>Talk</title>\n<link rel="stylesheet" href="theme.css" data-deck-theme>\n</head>';
const A = '<div data-block="a" style="left: 240px; top: 400px; width: 400px; height: 160px;"><p>Alpha</p></div>';
const B = '<div data-block="b" style="left: 1200px; top: 640px; width: 480px; height: 240px;"><p>Beta</p></div>';
const TITLE = '<div data-block="title" style="left: 120px; top: 80px; width: 1680px; height: 200px;"><h1>Title</h1></div>';
const DECK = [
  "<!doctype html>",
  '<html lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px">',
  HEAD,
  "<body>",
  `<section data-slide>\n${TITLE}\n${A}\n${B}\n</section>`,
  '<section data-slide>\n<div data-block="body" style="left: 120px; top: 320px; width: 1680px; height: 600px;"><p>Second.</p></div>\n</section>',
  "</body>",
  "</html>",
  "",
].join("\n");
const POSTER = [
  "<!doctype html>",
  '<html lang="en" data-deck="poster" data-deck-version="1" data-deck-size="841x1189mm">',
  HEAD,
  "<body>",
  '<section data-slide>\n<div data-block="title" style="left: 100px; top: 100px; width: 2000px; height: 300px;"><h1>Poster</h1></div>\n</section>',
  "</body>",
  "</html>",
  "",
].join("\n");
// An invalid block id makes the deck open read-only.
const INVALID = DECK.replace('data-block="b"', 'data-block="Bad_Id"');

// --- jsdom shims -------------------------------------------------------------------------------------------------------------------

const written = new WeakMap<HTMLIFrameElement, string>();
let observer: MutationObserver | undefined;

function loadSrcdocFrames(): void {
  for (const frame of Array.from(document.querySelectorAll("iframe"))) {
    const srcdoc = frame.getAttribute("srcdoc");
    const doc = frame.contentDocument;
    if (srcdoc == null || !doc || written.get(frame) === srcdoc) continue;
    written.set(frame, srcdoc);
    doc.open();
    doc.write(srcdoc);
    doc.close();
    frame.dispatchEvent(new Event("load"));
  }
}

beforeAll(() => {
  const el = Element.prototype as unknown as Record<string, unknown>;
  el.setPointerCapture ??= () => undefined;
  el.releasePointerCapture ??= () => undefined;
  el.hasPointerCapture ??= () => false;
  observer = new MutationObserver(loadSrcdocFrames);
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["srcdoc"] });
});
afterAll(() => observer?.disconnect());

// --- helpers -----------------------------------------------------------------------------------------------------------------------

let host: HTMLElement;
let workspace: DeckWorkspaceController | undefined;
let bare: { destroy(): void } | undefined;
const loadMath = jest.fn(async () => ({ renderMathSvg: () => '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>' }));

afterEach(() => {
  workspace?.destroy();
  bare?.destroy();
  workspace = undefined;
  bare = undefined;
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    loadSrcdocFrames();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function openWs(html: string = DECK, extra: Partial<DeckWorkspaceOptions> = {}) {
  host = document.createElement("div");
  document.body.append(host);
  const onChange = jest.fn<void, [DeckEditorChange]>();
  workspace = openDeckWorkspace(host, { title: "My talk", html, theme: THEME, resolveAsset: async (p: string) => `blob:asset/${p}`, loadMath, onChange, ...extra });
  await settle();
  return onChange;
}

const root = (): HTMLElement => host.querySelector<HTMLElement>(".dw")!;
const header = (): HTMLElement | null => host.querySelector<HTMLElement>("header.dw-header");
const toolbarOf = (label: string): HTMLElement | null => host.querySelector<HTMLElement>(`[role='toolbar'][aria-label='${label}']`);
const buttonIn = (scope: ParentNode | null, label: string): HTMLButtonElement | null =>
  Array.from(scope?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => b.getAttribute("aria-label") === label) ?? null;
const headerButton = (label: string): HTMLButtonElement | null => buttonIn(header(), label);
const zoomLabel = (): string => toolbarOf("Zoom")?.querySelector(".dw-zoom-label")?.textContent ?? "";
const stage = (): HTMLElement => host.querySelector<HTMLElement>(".deck-editor-stage")!;
const named = (label: string): HTMLElement | null =>
  Array.from(host.querySelectorAll<HTMLElement>("button, [role='button']")).find((el) => el.getAttribute("aria-label") === label) ?? null;
const MOD: KeyboardEventInit = { ctrlKey: true, metaKey: true };

/** Dispatches a keydown on the stage and returns the event, so a test can see whether it was handled. */
function press(k: string, init: KeyboardEventInit = {}, target: Element = stage()): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}
const blockIds = (html: string, slide = 0) => parseDeck(html).model?.slides[slide]?.blocks.map((b) => b.id);
const lastChange = (onChange: jest.Mock<void, [DeckEditorChange]>): DeckEditorChange => {
  const calls = onChange.mock.calls;
  if (calls.length === 0) throw new Error("onChange was not called");
  return calls[calls.length - 1]![0];
};
const moveA = (left: number) => (html: string) => applyDeckEdit(html, { kind: "move", block: "a", left, top: 400 });
const leftOfA = (html: string): number | undefined => parseDeck(html).model?.slides[0]?.blocks.find((b) => b.id === "a")?.rect?.left;

// --- A4: the shell around the editor ------------------------------------------------------------------------------------------------

describe("openDeckWorkspace renders the shell", () => {
  it("A4 mounts the shell root with data-format html, data-kind and data-mode visual", async () => {
    await openWs();
    expect(root().dataset["format"]).toBe("html");
    expect(root().dataset["kind"]).toBe("talk");
    expect(root().dataset["mode"]).toBe("visual");
  });

  it("A4 the shell root holds the header, the insert bar, the body and the status in that order", async () => {
    await openWs();
    const kids = Array.from(root().children);
    expect(kids[0]!.matches("header.dw-header")).toBe(true);
    expect(kids[1]!.matches("[role='toolbar'][aria-label='Insert']")).toBe(true);
    expect(kids[2]!.classList.contains("dw-body")).toBe(true);
    expect(kids[3]!.matches("footer.dw-status")).toBe(true);
  });

  it("A4 the header shows the title and a Talk badge", async () => {
    await openWs();
    expect(header()!.querySelector(".dw-title")!.textContent).toBe("My talk");
    expect(header()!.querySelector(".dw-badge")!.textContent).toBe("Talk");
  });

  it("A4 a poster's header shows a Poster badge and the shell root has data-kind poster", async () => {
    await openWs(POSTER);
    expect(header()!.querySelector(".dw-badge")!.textContent).toBe("Poster");
    expect(root().dataset["kind"]).toBe("poster");
  });

  it("A4 the header has Visual and Code mode tabs with Visual selected", async () => {
    await openWs();
    const tabs = Array.from(header()!.querySelectorAll<HTMLElement>("[role='tab']"));
    expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual(["Visual", "Code"]);
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);
  });

  it("A4 the Code tab opens the HTML source view and the Visual tab selects back", async () => {
    await openWs();
    expect(host.querySelector("[aria-label='Deck source']")).toBeNull();
    headerButton("Code")!.click();
    await settle();
    expect(host.querySelector("[aria-label='Deck source']")).not.toBeNull();
    expect(headerButton("Code")!.getAttribute("aria-selected")).toBe("true");
    expect(headerButton("Visual")!.getAttribute("aria-selected")).toBe("false");
    headerButton("Visual")!.click();
    await settle();
    expect(headerButton("Visual")!.getAttribute("aria-selected")).toBe("true");
  });

  it("A4 the saved indicator reads Saved and setSaved(false) turns it to Unsaved changes", async () => {
    await openWs();
    const saved = () => header()!.querySelector<HTMLElement>(".dw-saved")!;
    expect(saved().dataset["saved"]).toBe("true");
    expect(saved().textContent).toBe("Saved");
    workspace!.setSaved(false);
    expect(saved().dataset["saved"]).toBe("false");
    expect(saved().textContent).toBe("Unsaved changes");
    workspace!.setSaved(true);
    expect(saved().textContent).toBe("Saved");
  });

  it("A4 without host commands the header has no Present, Preview or Export button", async () => {
    await openWs();
    expect(headerButton("Present")).toBeNull();
    expect(headerButton("Preview")).toBeNull();
    expect(Array.from(header()!.querySelectorAll("button")).some((b) => /^Export/.test(b.getAttribute("aria-label") ?? ""))).toBe(false);
  });

  it("A4 a talk with a present command shows Present, which calls it, and no Preview", async () => {
    const present = jest.fn();
    await openWs(DECK, { commands: { present, preview: jest.fn() } });
    expect(headerButton("Preview")).toBeNull();
    headerButton("Present")!.click();
    expect(present).toHaveBeenCalledTimes(1);
  });

  it("A4 a poster with a preview command shows Preview, which calls it, and no Present", async () => {
    const preview = jest.fn();
    await openWs(POSTER, { commands: { present: jest.fn(), preview } });
    expect(headerButton("Present")).toBeNull();
    headerButton("Preview")!.click();
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it("A4 a single export command shows one button named Export with its label that calls it", async () => {
    const exportPdf = jest.fn();
    await openWs(DECK, { commands: { exportPdf } });
    headerButton("Export PDF")!.click();
    expect(exportPdf).toHaveBeenCalledTimes(1);
  });

  it("A4 two or more export commands show one Export button that opens a menu of them", async () => {
    const exportPdf = jest.fn();
    const shareLink = jest.fn();
    await openWs(DECK, { commands: { exportPdf, shareLink } });
    headerButton("Export")!.click();
    await settle();
    const items = Array.from(document.querySelectorAll<HTMLElement>("[role='menuitem']"));
    expect(items.map((i) => i.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("PDF"), expect.stringContaining("Share link")]));
    items.find((i) => i.textContent!.includes("Share link"))!.click();
    expect(shareLink).toHaveBeenCalledTimes(1);
    expect(exportPdf).not.toHaveBeenCalled();
  });

  it("A4 the insert bar is a toolbar named Insert with Undo, Redo, Text, Image, Equation, Shapes and New slide", async () => {
    await openWs();
    const insert = toolbarOf("Insert")!;
    for (const label of ["Undo", "Redo", "Text", "Image", "Equation", "Shapes", "New slide"]) expect(buttonIn(insert, label)).not.toBeNull();
  });

  it("A4 a poster's insert bar has no New slide", async () => {
    await openWs(POSTER);
    expect(buttonIn(toolbarOf("Insert"), "New slide")).toBeNull();
  });

  it("A4 the insert bar's Undo is disabled until there is something to undo and then undoes the last edit", async () => {
    const onChange = await openWs();
    const undo = () => buttonIn(toolbarOf("Insert"), "Undo")!;
    expect(undo().disabled).toBe(true);
    workspace!.edit([moveA(264)], "Move block");
    await settle();
    expect(undo().disabled).toBe(false);
    undo().click();
    await settle();
    expect(lastChange(onChange).label).toBe("Undo");
    expect(leftOfA(lastChange(onChange).html)).toBe(240);
  });

  it("A4 the insert bar's Text button adds a block to the slide", async () => {
    const onChange = await openWs();
    buttonIn(toolbarOf("Insert"), "Text")!.click();
    await settle();
    expect(blockIds(lastChange(onChange).html)!.length).toBe(4);
  });

  it("A4 the shell zoom bar is a toolbar named Zoom with Select, Hand, Zoom out, Zoom in and Fit", async () => {
    await openWs();
    const zoom = toolbarOf("Zoom")!;
    for (const label of ["Select", "Hand", "Zoom out", "Zoom in", "Fit"]) expect(buttonIn(zoom, label)).not.toBeNull();
    expect(zoom.closest(".dw-body")).not.toBeNull();
  });

  it("A4 the zoom label reads Fit with the percent while the editor fits the slide", async () => {
    await openWs();
    expect(zoomLabel()).toMatch(/^Fit · \d+%$/);
  });

  it("A4 the zoom label follows the editor's zoom set through the controller", async () => {
    await openWs();
    workspace!.setZoom(0.5);
    expect(zoomLabel()).toBe("50%");
    workspace!.setZoom("fit");
    expect(zoomLabel()).toMatch(/^Fit · /);
  });

  it("A4 Zoom in steps the editor to the next percent step and the label reads it", async () => {
    await openWs();
    workspace!.setZoom(1);
    expect(zoomLabel()).toBe("100%");
    buttonIn(toolbarOf("Zoom"), "Zoom in")!.click();
    expect(zoomLabel()).toBe("125%");
    buttonIn(toolbarOf("Zoom"), "Zoom out")!.click();
    buttonIn(toolbarOf("Zoom"), "Zoom out")!.click();
    expect(zoomLabel()).toBe("75%");
  });

  it("A4 the Fit button returns the editor to fit", async () => {
    await openWs();
    workspace!.setZoom(2);
    expect(zoomLabel()).toBe("200%");
    buttonIn(toolbarOf("Zoom"), "Fit")!.click();
    expect(zoomLabel()).toMatch(/^Fit · /);
  });

  it("A4 the Hand tool button is pressed on click and Select is released", async () => {
    await openWs();
    const zoom = toolbarOf("Zoom");
    expect(buttonIn(zoom, "Select")!.getAttribute("aria-pressed")).toBe("true");
    buttonIn(zoom, "Hand")!.click();
    expect(buttonIn(zoom, "Hand")!.getAttribute("aria-pressed")).toBe("true");
    expect(buttonIn(zoom, "Select")!.getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelector(".deck-editor")!.classList.contains("is-hand")).toBe(true);
  });

  it("A4 the status shows the slide position and the size for a talk", async () => {
    await openWs();
    expect(host.querySelector(".dw-status-left")!.textContent).toBe("Slide 1 of 2 · 1920 × 1080 px");
    workspace!.selectSlide(1);
    await settle();
    expect(host.querySelector(".dw-status-left")!.textContent).toBe("Slide 2 of 2 · 1920 × 1080 px");
  });

  it("A4 the status shows Poster and the size for a poster", async () => {
    await openWs(POSTER);
    expect(host.querySelector(".dw-status-left")!.textContent).toBe("Poster · 841 × 1189 mm");
  });

  it("A4 the status shows a non-empty hint", async () => {
    await openWs();
    expect((host.querySelector(".dw-hint")!.textContent ?? "").length).toBeGreaterThan(0);
  });

  it("A4 the status state follows setSaved between saved and dirty", async () => {
    await openWs();
    const right = () => host.querySelector<HTMLElement>(".dw-status-right")!;
    expect(right().dataset["state"]).toBe("saved");
    workspace!.setSaved(false);
    expect(right().dataset["state"]).toBe("dirty");
    expect(right().textContent).toContain("Unsaved");
  });

  it("A4 a deck with errors shows the problem state with its errors in the status", async () => {
    await openWs(INVALID);
    const right = host.querySelector<HTMLElement>(".dw-status-right")!;
    expect(right.dataset["state"]).toBe("problem");
    expect(right.textContent).toContain("read-only");
  });
});

// --- A4: shortcuts -------------------------------------------------------------------------------------------------------------------

describe("openDeckWorkspace shortcuts", () => {
  it("A4 Mod+Z undoes the last edit once", async () => {
    const onChange = await openWs();
    workspace!.edit([moveA(264)], "Move block");
    workspace!.edit([moveA(288)], "Move block");
    const event = press("z", MOD);
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(lastChange(onChange).label).toBe("Undo");
    expect(leftOfA(lastChange(onChange).html)).toBe(264);
    expect(onChange.mock.calls.filter(([c]) => c.label === "Undo")).toHaveLength(1);
  });

  it("A4 Mod+Shift+Z redoes what was undone", async () => {
    const onChange = await openWs();
    workspace!.edit([moveA(264)], "Move block");
    press("z", MOD);
    expect(leftOfA(lastChange(onChange).html)).toBe(240);
    press("Z", { ...MOD, shiftKey: true });
    await settle();
    expect(lastChange(onChange).label).toBe("Redo");
    expect(leftOfA(lastChange(onChange).html)).toBe(264);
  });

  it("A4 Mod+Y redoes what was undone", async () => {
    const onChange = await openWs();
    workspace!.edit([moveA(264)], "Move block");
    press("z", MOD);
    press("y", MOD);
    expect(lastChange(onChange).label).toBe("Redo");
  });

  it("A4 with history host Mod+Z calls onUndo once and Mod+Shift+Z calls onRedo once", async () => {
    const onUndo = jest.fn();
    const onRedo = jest.fn();
    await openWs(DECK, { history: "host", onUndo, onRedo });
    press("z", MOD);
    expect(onUndo).toHaveBeenCalledTimes(1);
    press("Z", { ...MOD, shiftKey: true });
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it("A4 Mod+0 fits the zoom", async () => {
    await openWs();
    workspace!.setZoom(0.5);
    expect(zoomLabel()).toBe("50%");
    const event = press("0", MOD);
    expect(event.defaultPrevented).toBe(true);
    expect(zoomLabel()).toMatch(/^Fit · /);
  });

  it("A4 Mod+= and Mod+- walk the zoom steps", async () => {
    await openWs();
    workspace!.setZoom(1);
    press("=", MOD);
    expect(zoomLabel()).toBe("125%");
    press("-", MOD);
    press("-", MOD);
    expect(zoomLabel()).toBe("75%");
  });

  it("A4 H picks the Hand tool and V picks Select", async () => {
    await openWs();
    const zoom = toolbarOf("Zoom");
    press("h");
    expect(buttonIn(zoom, "Hand")!.getAttribute("aria-pressed")).toBe("true");
    press("v");
    expect(buttonIn(zoom, "Select")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("A4 Escape clears the selection", async () => {
    await openWs();
    workspace!.selectBlocks(["a"]);
    await settle();
    expect(named("Resize se")).not.toBeNull();
    press("Escape");
    await settle();
    expect(named("Resize se")).toBeNull();
  });

  it("A4 Delete removes the selected block", async () => {
    const onChange = await openWs();
    workspace!.selectBlocks(["a"]);
    await settle();
    const event = press("Delete");
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(lastChange(onChange).label).toBe("Delete block");
    expect(blockIds(lastChange(onChange).html)).toEqual(["title", "b"]);
  });

  it("A4 Backspace removes the selected block", async () => {
    const onChange = await openWs();
    workspace!.selectBlocks(["b"]);
    await settle();
    press("Backspace");
    await settle();
    expect(blockIds(lastChange(onChange).html)).toEqual(["title", "a"]);
  });

  it("A4 Delete with nothing selected changes nothing", async () => {
    const onChange = await openWs();
    press("Delete");
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("A4 Mod+D duplicates the selected block", async () => {
    const onChange = await openWs();
    workspace!.selectBlocks(["a"]);
    await settle();
    press("d", MOD);
    await settle();
    expect(blockIds(lastChange(onChange).html)!.length).toBe(4);
  });

  it("A4 PageDown goes to the next slide and PageUp back", async () => {
    await openWs();
    expect(workspace!.currentSlide()).toBe(0);
    const event = press("PageDown");
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(workspace!.currentSlide()).toBe(1);
    press("PageUp");
    await settle();
    expect(workspace!.currentSlide()).toBe(0);
  });

  it("A4 shortcuts do nothing while the deck is read-only", async () => {
    const onChange = await openWs(INVALID);
    press("PageDown");
    press("Delete");
    press("z", MOD);
    await settle();
    expect(workspace!.currentSlide()).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("A4 Delete does not remove a block while its text is being edited", async () => {
    const onChange = await openWs();
    workspace!.selectBlocks(["a"]);
    workspace!.editText("a");
    await settle();
    press("Delete");
    await settle();
    expect(onChange.mock.calls.some(([c]) => c.label === "Delete block")).toBe(false);
  });

  it("A4 keys typed into a text field in the shell are ignored", async () => {
    const onChange = await openWs();
    workspace!.selectBlocks(["a"]);
    await settle();
    const input = document.createElement("input");
    root().append(input);
    const event = press("Delete", {}, input);
    await settle();
    expect(event.defaultPrevented).toBe(false);
    expect(onChange.mock.calls.some(([c]) => c.label === "Delete block")).toBe(false);
  });

  it("A4 after destroy the shell root is gone", async () => {
    await openWs();
    workspace!.destroy();
    expect(host.querySelector(".dw")).toBeNull();
    workspace = undefined;
  });
});

// --- A4: the bare editor and the move ------------------------------------------------------------------------------------------------

describe("openDeckEditor is the bare editor", () => {
  const openBare = async (html: string = DECK, extra: Record<string, unknown> = {}) => {
    host = document.createElement("div");
    document.body.append(host);
    bare = openDeckEditor(host, { html, theme: THEME, resolveAsset: async (p: string) => `blob:asset/${p}`, loadMath, onChange: jest.fn(), ...extra });
    await settle();
  };

  it("A4 mounts a .deck-editor.deck-editor-bare root with the stage and the frame", async () => {
    await openBare();
    expect(host.querySelector(".deck-editor.deck-editor-bare")).not.toBeNull();
    expect(host.querySelector(".deck-editor-stage")).not.toBeNull();
    expect(host.querySelectorAll("iframe").length).toBeGreaterThan(0);
  });

  it("A4 has no toolbar, no status line and no problems list", async () => {
    await openBare();
    expect(host.querySelector("[role='toolbar']")).toBeNull();
    expect(host.querySelector(".deck-editor-toolbar")).toBeNull();
    expect(host.querySelector(".deck-editor-status, [role='status']")).toBeNull();
    expect(host.querySelector(".deck-editor-problems, [aria-label='Deck problems']")).toBeNull();
  });

  it("A4 a deck with errors lists no problems in the bare editor", async () => {
    await openBare(INVALID);
    expect(host.querySelector(".deck-editor-problem")).toBeNull();
    expect(host.querySelector(".deck-editor-problems")).toBeNull();
  });

  it("A4 has no built-in slide strip", async () => {
    await openBare();
    expect(host.querySelector(".deck-editor-strip, [class*='deck-editor-strip']")).toBeNull();
  });

  it("A4 a leftover bare: false option no longer brings a toolbar back", async () => {
    await openBare(DECK, { bare: false });
    expect(host.querySelector("[role='toolbar']")).toBeNull();
    expect(host.querySelector(".deck-editor-bare")).not.toBeNull();
  });

  it("A4 the bare editor still takes the stage keys: an arrow nudges the selected block", async () => {
    const onChange = jest.fn<void, [DeckEditorChange]>();
    host = document.createElement("div");
    document.body.append(host);
    const ed = openDeckEditor(host, { html: DECK, theme: THEME, resolveAsset: async (p: string) => `blob:asset/${p}`, loadMath, onChange });
    bare = ed;
    await settle();
    ed.selectBlocks(["a"]);
    await settle();
    press("ArrowRight");
    await settle();
    expect(leftOfA(lastChange(onChange).html)).toBe(241);
  });
});

describe("the deck shell moved", () => {
  const core = path.resolve(__dirname, "../../../../..");

  it("A4 packages/core/src/decks/dom/deckShell/ no longer exists", () => {
    expect(fs.existsSync(path.join(core, "src/decks/dom/deckShell"))).toBe(false);
  });

  it("A4 the HTML shell lives in shell/html/ with an index and a shell module", () => {
    expect(fs.existsSync(path.join(core, "src/decks/dom/shell/html/index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(core, "src/decks/dom/shell/html/shell.ts"))).toBe(true);
  });

  it("A4 the deck-shell style exports point at files that exist outside deckShell/", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(core, "package.json"), "utf8")) as { exports: Record<string, string> };
    for (const key of ["./styles/deck-shell.css", "./styles/deck-shell-panels.css"]) {
      const target = pkg.exports[key]!;
      expect(target).not.toContain("deckShell");
      expect(fs.existsSync(path.resolve(core, target))).toBe(true);
    }
  });
});
