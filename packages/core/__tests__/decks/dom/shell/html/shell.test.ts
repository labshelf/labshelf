/** @jest-environment jsdom */
// Spec 2.3: HTML decks run in the shell. openDeckWorkspace renders the shell's header, insert bar, zoom bar and status around the bare editor; the shell moved to shell/html/.
import * as fs from "node:fs";
import * as path from "node:path";
import { DECK, POSTER, INVALID, host, workspace, settle, openWs, root, header, toolbarOf, buttonIn, headerButton, zoomLabel, blockIds, lastChange, moveA, leftOfA } from "./shellHarness";

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
