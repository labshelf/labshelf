/** @jest-environment jsdom */
// Spec 2.3: openDeckWorkspace handles the shell key map, and openDeckEditor on its own is the bare editor with no toolbar, status line or problems list.
import { openDeckEditor, type DeckEditorChange } from "../../../../../src/decks/dom/openDeckEditor";
import { THEME, DECK, INVALID, host, workspace, loadMath, settle, openWs, root, toolbarOf, buttonIn, zoomLabel, named, MOD, press, blockIds, lastChange, moveA, leftOfA, setHost, setWorkspace, setBare } from "./shellHarness";

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
    setWorkspace(undefined);
  });
});

// --- A4: the bare editor and the move ------------------------------------------------------------------------------------------------

describe("openDeckEditor is the bare editor", () => {
  const openBare = async (html: string = DECK, extra: Record<string, unknown> = {}) => {
    setHost(document.createElement("div"));
    document.body.append(host);
    setBare(openDeckEditor(host, { html, theme: THEME, resolveAsset: async (p: string) => `blob:asset/${p}`, loadMath, onChange: jest.fn(), ...extra }));
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
    setHost(document.createElement("div"));
    document.body.append(host);
    const ed = openDeckEditor(host, { html: DECK, theme: THEME, resolveAsset: async (p: string) => `blob:asset/${p}`, loadMath, onChange });
    setBare(ed);
    await settle();
    ed.selectBlocks(["a"]);
    await settle();
    press("ArrowRight");
    await settle();
    expect(leftOfA(lastChange(onChange).html)).toBe(241);
  });
});

