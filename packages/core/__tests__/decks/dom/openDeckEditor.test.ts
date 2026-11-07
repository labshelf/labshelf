/** @jest-environment jsdom */
/**
 * Tests openDeckEditor (spec 5.3), mounted in the HTML deck shell (openDeckWorkspace, spec 2.3), in jsdom through its public seam: the host element, the options going in, the changes handed to
 * onChange, the controller, and the DOM the editor builds (accessible names, the frame's contentDocument).
 * jsdom has no layout: the stage clientWidth is 0, so the editor's scale is 1 and pointer deltas are slide px; geometry is read from
 * the model by parsing the html passed to onChange. jsdom does not load srcdoc frames, so a MutationObserver loads each srcdoc into
 * the frame's document and fires load, as a browser would. The math loader is a jest mock.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseDeck } from "../../../src/decks/deckParse";
import { loadDeckEditor } from "../../../src/decks/dom/openDeckEditor";
import { validateDeck } from "../../../src/decks/deckValidate";
import { THEME, DECK, INVALID, settle, open, named, box, handleOf, boxes, toolbar, toolButton, isDisabled, frameDoc, frameBlock, pointer, key, MOD, select, rectOf, blockIds, changes, lastChange, host, editor } from "./openDeckEditorHarness";

// --- 5.3a ---------------------------------------------------------------------------------------------------------------------------

describe("openDeckEditor layout", () => {
  it("5.3a mounts a .deck-editor root in the shell, whose Insert toolbar holds Undo and Redo", async () => {
    await open();
    expect(host.querySelector(".deck-editor")).not.toBeNull();
    expect(toolbar()?.getAttribute("aria-label")).toBe("Insert");
    for (const label of ["Undo", "Redo"]) expect(toolButton(label)).toBeTruthy();
  });

  it("5.3a mounts one sandboxed frame for the first slide", async () => {
    await open();
    const frames = host.querySelectorAll("iframe");
    expect(frames).toHaveLength(1);
    expect(frames[0]!.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frames[0]!.getAttribute("title")).toBe("Slide 1");
    expect(editor!.currentSlide()).toBe(0);
  });

  it("5.3a has one overlay box per block of the slide, named Block <id>", async () => {
    await open();
    expect(boxes().map((b) => b.getAttribute("aria-label")).sort()).toEqual(["Block a", "Block b", "Block title"]);
  });

  it("5.3a the selected box has eight handles named Resize <handle>", async () => {
    await open();
    expect(named("Resize se")).toBeNull();
    await select("a");
    for (const h of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) expect(handleOf(h)).toBeTruthy();
  });

  it("5.3a before a gesture no element carries a transform and the toolbar has no style attribute", async () => {
    await open();
    expect(toolbar()!.querySelectorAll("[style]")).toHaveLength(0);
    expect(toolbar()!.hasAttribute("style")).toBe(false);
    for (const el of Array.from(host.querySelectorAll<HTMLElement>("*"))) expect(el.style?.transform ?? "").toBe("");
    for (const el of Array.from(frameDoc().querySelectorAll<HTMLElement>("[data-block]"))) expect(el.style.transform).toBe("");
  });
});

// --- 5.3b ---------------------------------------------------------------------------------------------------------------------------

describe("openDeckEditor drag and resize", () => {
  it("5.3b during a drag only a transform is set on the box and the frame block, and nothing is changed", async () => {
    const onChange = await open();
    const before = { left: box("a").style.left, top: box("a").style.top, width: box("a").style.width, height: box("a").style.height };
    pointer("pointerdown", box("a"), 300, 450);
    pointer("pointermove", box("a"), 340, 474);
    pointer("pointermove", box("a"), 380, 498);
    const moving = box("a");
    expect(moving.style.transform).not.toBe("");
    expect({ left: moving.style.left, top: moving.style.top, width: moving.style.width, height: moving.style.height }).toEqual(before);
    expect(frameBlock("a")?.style.transform).not.toBe("");
    expect(frameBlock("a")?.style.left).toBe("240px");
    expect(frameBlock("a")?.style.top).toBe("400px");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("5.3b pointerup gives one Move block change whose html moves the block", async () => {
    const onChange = await open();
    pointer("pointerdown", box("a"), 300, 450);
    pointer("pointermove", box("a"), 340, 474);
    pointer("pointermove", box("a"), 380, 498);
    pointer("pointerup", box("a"), 380, 498);
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    const change = lastChange(onChange);
    expect(change.label).toBe("Move block");
    expect(change.theme).toBe(THEME);
    expect(rectOf(change.html, "a")).toEqual({ left: 320, top: 448, width: 400, height: 160 });
    expect(rectOf(change.html, "b")).toEqual({ left: 1200, top: 640, width: 480, height: 240 });
  });

  it("5.3b after pointerup no element carries a transform", async () => {
    await open();
    pointer("pointerdown", box("a"), 300, 450);
    pointer("pointermove", box("a"), 380, 498);
    pointer("pointerup", box("a"), 380, 498);
    await settle();
    for (const el of Array.from(host.querySelectorAll<HTMLElement>("*"))) expect(el.style?.transform ?? "").toBe("");
    expect(frameBlock("a")?.style.transform ?? "").toBe("");
  });

  it("5.3b a press and release without moving changes nothing", async () => {
    const onChange = await open();
    await select("a");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("5.3b resize from the se handle gives one Resize block change", async () => {
    const onChange = await open();
    await select("a");
    pointer("pointerdown", handleOf("se"), 640, 560);
    pointer("pointermove", handleOf("se"), 660, 576);
    pointer("pointermove", handleOf("se"), 680, 592);
    expect(onChange).not.toHaveBeenCalled();
    pointer("pointerup", handleOf("se"), 680, 592);
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    const change = lastChange(onChange);
    expect(change.label).toBe("Resize block");
    expect(rectOf(change.html, "a")).toEqual({ left: 240, top: 400, width: 440, height: 192 });
  });
});

// --- 5.3c ---------------------------------------------------------------------------------------------------------------------------

describe("openDeckEditor text editing", () => {
  const leaf = () => frameDoc().querySelector<HTMLElement>('[data-block="title"] h1')!;
  const blurLeaf = (el: HTMLElement) => {
    const view = el.ownerDocument.defaultView ?? window;
    el.dispatchEvent(new view.FocusEvent("blur", { bubbles: false }));
    el.dispatchEvent(new view.FocusEvent("focusout", { bubbles: true }));
  };

  it("5.3c double-click on a block makes its first leaf contenteditable in the frame", async () => {
    await open();
    pointer("dblclick", box("title"), 200, 150);
    await settle();
    expect(leaf().getAttribute("contenteditable")).toBe("true");
  });

  it("5.3c Enter commits one Edit text change with the leaf's new text", async () => {
    const onChange = await open();
    pointer("dblclick", box("title"), 200, 150);
    await settle();
    leaf().textContent = "New title";
    key(leaf(), "Enter");
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    const change = lastChange(onChange);
    expect(change.label).toBe("Edit text");
    expect(parseDeck(change.html).model?.slides[0]?.blocks.find((b) => b.id === "title")?.leaves[0]?.text).toBe("New title");
  });

  it("5.3c blur commits one Edit text change", async () => {
    const onChange = await open();
    pointer("dblclick", box("title"), 200, 150);
    await settle();
    leaf().textContent = "Blurred title";
    blurLeaf(leaf());
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastChange(onChange).label).toBe("Edit text");
    expect(parseDeck(lastChange(onChange).html).model?.slides[0]?.blocks.find((b) => b.id === "title")?.leaves[0]?.text).toBe("Blurred title");
  });

  it("5.3c Escape restores the text and commits nothing", async () => {
    const onChange = await open();
    pointer("dblclick", box("title"), 200, 150);
    await settle();
    const el = leaf();
    el.textContent = "Discarded";
    key(el, "Escape");
    await settle();
    expect(leaf().textContent).toBe("Title");
    blurLeaf(leaf());
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("5.3c an unchanged text commits nothing", async () => {
    const onChange = await open();
    pointer("dblclick", box("title"), 200, 150);
    await settle();
    key(leaf(), "Enter");
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });
});

// --- 5.3d ---------------------------------------------------------------------------------------------------------------------------

describe("openDeckEditor keyboard and history", () => {
  it("5.3d ArrowRight nudges the selected block 1 px as one Move block change", async () => {
    const onChange = await open();
    await select("a");
    key(box("a"), "ArrowRight");
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastChange(onChange).label).toBe("Move block");
    expect(rectOf(lastChange(onChange).html, "a")).toEqual({ left: 241, top: 400, width: 400, height: 160 });
  });

  it("5.3d Shift+ArrowDown nudges the selected block 10 px", async () => {
    const onChange = await open();
    await select("a");
    key(box("a"), "ArrowDown", { shiftKey: true });
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(rectOf(lastChange(onChange).html, "a")).toEqual({ left: 240, top: 410, width: 400, height: 160 });
  });

  it("5.3d each key press is one change and builds on the previous one", async () => {
    const onChange = await open();
    await select("a");
    key(box("a"), "ArrowLeft");
    await settle();
    key(box("a"), "ArrowUp", { shiftKey: true });
    await settle();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(rectOf(lastChange(onChange).html, "a")).toEqual({ left: 239, top: 390, width: 400, height: 160 });
  });

  it("5.3d Delete removes the selected block as one Delete block change", async () => {
    const onChange = await open();
    await select("a");
    key(box("a"), "Delete");
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastChange(onChange).label).toBe("Delete block");
    expect(blockIds(lastChange(onChange).html)).toEqual(["title", "b"]);
  });

  it("5.3d Mod+Z undoes and Mod+Shift+Z redoes with internal history", async () => {
    const onChange = await open();
    await select("a");
    key(box("a"), "ArrowRight");
    await settle();
    const moved = lastChange(onChange).html;
    key(box("a"), "z", MOD);
    await settle();
    expect(lastChange(onChange)).toEqual({ html: DECK, theme: THEME, label: "Undo" });
    key(box("a"), "z", { ...MOD, shiftKey: true });
    await settle();
    expect(lastChange(onChange)).toEqual({ html: moved, theme: THEME, label: "Redo" });
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("5.3d Mod+Y redoes with internal history", async () => {
    const onChange = await open();
    await select("a");
    key(box("a"), "ArrowRight");
    await settle();
    const moved = lastChange(onChange).html;
    key(box("a"), "z", MOD);
    await settle();
    key(box("a"), "y", MOD);
    await settle();
    expect(lastChange(onChange)).toEqual({ html: moved, theme: THEME, label: "Redo" });
  });

  it("5.3d the Undo button is disabled until a change and then undoes", async () => {
    const onChange = await open();
    expect(isDisabled(toolButton("Undo"))).toBe(true);
    expect(isDisabled(toolButton("Redo"))).toBe(true);
    await select("a");
    key(box("a"), "ArrowRight");
    await settle();
    expect(isDisabled(toolButton("Undo"))).toBe(false);
    toolButton("Undo").click();
    await settle();
    expect(lastChange(onChange)).toEqual({ html: DECK, theme: THEME, label: "Undo" });
    expect(isDisabled(toolButton("Redo"))).toBe(false);
  });

  it("5.3d controller undo and redo use the internal history", async () => {
    const onChange = await open();
    await select("a");
    key(box("a"), "ArrowRight");
    await settle();
    const moved = lastChange(onChange).html;
    editor!.undo();
    await settle();
    expect(lastChange(onChange)).toEqual({ html: DECK, theme: THEME, label: "Undo" });
    editor!.redo();
    await settle();
    expect(lastChange(onChange)).toEqual({ html: moved, theme: THEME, label: "Redo" });
  });

  it("5.3d history host: Mod+Z and Mod+Shift+Z call onUndo and onRedo and no Undo or Redo change", async () => {
    const onUndo = jest.fn();
    const onRedo = jest.fn();
    const onChange = await open(DECK, { history: "host", onUndo, onRedo });
    await select("a");
    key(box("a"), "ArrowRight");
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    key(box("a"), "z", MOD);
    await settle();
    expect(onUndo).toHaveBeenCalledTimes(1);
    key(box("a"), "z", { ...MOD, shiftKey: true });
    await settle();
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(changes(onChange).map((c) => c.label)).toEqual(["Move block"]);
  });

  it("5.3d history host: controller undo and redo call onUndo and onRedo", async () => {
    const onUndo = jest.fn();
    const onRedo = jest.fn();
    const onChange = await open(DECK, { history: "host", onUndo, onRedo });
    editor!.undo();
    editor!.redo();
    await settle();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("5.3d history host: setDocument re-renders without calling onChange and keeps the selection", async () => {
    const onChange = await open(DECK, { history: "host", onUndo: jest.fn(), onRedo: jest.fn() });
    await select("a");
    const moved = DECK.replace("left: 240px; top: 400px;", "left: 248px; top: 400px;");
    editor!.setDocument(moved, THEME);
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    key(box("a"), "ArrowRight");
    await settle();
    expect(rectOf(lastChange(onChange).html, "a")).toEqual({ left: 249, top: 400, width: 400, height: 160 });
  });
});

// --- 5.3e ---------------------------------------------------------------------------------------------------------------------------

describe("openDeckEditor read-only mode", () => {
  // The shell's status names the problems in its problem state.
  const problems = () => host.querySelector<HTMLElement>(".dw-status-right[data-state='problem']");
  const expected = () =>
    validateDeck(INVALID, { theme: THEME })
      .filter((d) => d.severity === "error")
      .map((d) => `${d.code} line ${d.line}: ${d.message}`);

  it("5.3e an invalid deck shows each error and the read-only state in the status", async () => {
    await open(INVALID);
    const status = problems();
    expect(status).not.toBeNull();
    expect(expected().length).toBeGreaterThan(0);
    for (const line of expected()) expect(status!.textContent).toContain(line);
    expect(status!.textContent).toContain("This deck has errors and opens read-only");
  });

  it("5.3e an invalid deck has no overlay boxes", async () => {
    await open(INVALID);
    expect(boxes()).toHaveLength(0);
  });

  it("5.3e an invalid deck ignores double-click and keys", async () => {
    const onChange = await open(INVALID);
    const frame = host.querySelector("iframe");
    const stage = frame?.parentElement ?? host.querySelector<HTMLElement>(".deck-editor")!;
    pointer("dblclick", stage, 200, 150);
    const block = frame?.contentDocument?.querySelector<HTMLElement>('[data-block="title"]');
    if (block) pointer("dblclick", block.querySelector("h1") ?? block, 200, 150);
    for (const k of ["ArrowRight", "Delete", "Backspace", "Enter"]) key(stage, k);
    key(stage, "z", MOD);
    await settle();
    expect(host.querySelectorAll("[contenteditable='true']")).toHaveLength(0);
    expect(frame?.contentDocument?.querySelectorAll("[contenteditable='true']") ?? []).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("5.3e setDocument with a valid deck leaves read-only without calling onChange", async () => {
    const onChange = await open(INVALID);
    editor!.setDocument(DECK, THEME);
    await settle();
    expect(problems()).toBeNull();
    expect(host.textContent).not.toContain("This deck has errors and opens read-only");
    expect(boxes().map((b) => b.getAttribute("aria-label")).sort()).toEqual(["Block a", "Block b", "Block title"]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("5.3e setDocument with an invalid deck makes an editable deck read-only", async () => {
    await open(DECK);
    editor!.setDocument(INVALID, THEME);
    await settle();
    expect(problems()).not.toBeNull();
    expect(boxes()).toHaveLength(0);
  });
});

// --- 5.3f ---------------------------------------------------------------------------------------------------------------------------

describe("openDeckEditor packaging", () => {
  it("5.3f loadDeckEditor resolves to the module with openDeckEditor, and package.json exports ./deckEditor and ./styles/deck-editor.css", async () => {
    const mod = await loadDeckEditor();
    expect(typeof mod.openDeckEditor).toBe("function");
    const root = path.join(__dirname, "..", "..", "..");
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { exports: Record<string, string> };
    expect(pkg.exports["./deckEditor"]).toBe("./src/decks/dom/openDeckEditor.ts");
    expect(pkg.exports["./styles/deck-editor.css"]).toBe("./src/decks/dom/deck-editor.css");
    expect(fs.existsSync(path.join(root, "src/decks/dom/openDeckEditor.ts"))).toBe(true);
    expect(fs.existsSync(path.join(root, "src/decks/dom/deck-editor.css"))).toBe(true);
  });
});
