/** @jest-environment jsdom */
// Spec 2.3: the shell keys on a mounted compiled workspace, and its insert buttons that never wait for a selection (fake ports, see workspaceHarness.ts).
// Acceptance ids: A4 = the keys / the insert targets.
import { readSourceDeckBlocks, sourceDeckUnits } from "../../../../src/decks/index.js";
import { BEAMER, TIKZ, EMPTY_TALK, EMPTY_POSTER, COLUMN_ONLY_POSTER, flush, mod, press, Rig, mount, talk, poster, button, slideRows, statusLeft, zoomLabel, insertion } from "./workspaceHarness";

describe("shell keys on a mounted compiled workspace", () => {
  it("A4 Mod+= zooms in and Mod+0 fits, both prevented", async () => {
    const rig = talk();
    await flush();
    const zoomIn = press(rig.root, "=", mod());
    expect(zoomIn.defaultPrevented).toBe(true);
    expect(zoomLabel(rig)).toMatch(/^\d+%$/);
    const fit = press(rig.root, "0", mod());
    expect(fit.defaultPrevented).toBe(true);
    expect(zoomLabel(rig)).toMatch(/^Fit · \d+%$/);
  });

  it("A4 Mod+- zooms out", async () => {
    const rig = talk();
    await flush();
    press(rig.root, "-", mod());
    expect(zoomLabel(rig)).toMatch(/^\d+%$/);
  });

  it("A4 PageDown selects the next slide and PageUp the previous one", async () => {
    const rig = talk();
    await flush();
    slideRows(rig)[0]!.click();
    expect(statusLeft(rig)).toMatch(/^Slide 1 of 4/);
    const down = press(rig.root, "PageDown");
    expect(down.defaultPrevented).toBe(true);
    expect(statusLeft(rig)).toMatch(/^Slide 2 of 4/);
    press(rig.root, "PageDown");
    expect(statusLeft(rig)).toMatch(/^Slide 3 of 4/);
    press(rig.root, "PageUp");
    expect(statusLeft(rig)).toMatch(/^Slide 2 of 4/);
  });

  it("A4 PageDown on the last slide and PageUp on the first stay where they are", async () => {
    const rig = talk();
    await flush();
    slideRows(rig)[0]!.click();
    press(rig.root, "PageUp");
    expect(statusLeft(rig)).toMatch(/^Slide 1 of 4/);
    for (let i = 0; i < 6; i++) press(rig.root, "PageDown");
    expect(statusLeft(rig)).toMatch(/^Slide 4 of 4/);
  });

  it("A4 PageDown selects the slide in the structure panel too", async () => {
    const rig = talk();
    await flush();
    press(rig.root, "PageDown");
    const rows = [...rig.root.querySelectorAll('[aria-label="Slides"] [role="treeitem"]:not(.dw-preamble)')];
    expect(rows.map((row) => row.getAttribute("aria-selected"))).toEqual(["false", "true", "false", "false"]);
  });

  it("A4 Mod+Z calls editing.undo, Mod+Shift+Z and Mod+Y call editing.redo", async () => {
    const rig = talk();
    await flush();
    expect(press(rig.root, "z", mod()).defaultPrevented).toBe(true);
    expect([rig.calls.undo, rig.calls.redo]).toEqual([1, 0]);
    press(rig.root, "Z", mod({ shiftKey: true }));
    expect([rig.calls.undo, rig.calls.redo]).toEqual([1, 1]);
    press(rig.root, "y", mod());
    expect([rig.calls.undo, rig.calls.redo]).toEqual([1, 2]);
  });

  it("A4 Delete changes nothing when nothing is selected", async () => {
    const rig = poster();
    await flush();
    press(rig.root, "Delete");
    expect(rig.applied).toHaveLength(0);
  });

  it("A4 Delete and Mod+D edit nothing in a poster's Split or Code", async () => {
    const rig = poster();
    await flush();
    press(rig.root, "Delete");
    press(rig.root, "d", mod());
    rig.workspace.setMode("code");
    press(rig.root, "Delete");
    press(rig.root, "d", mod());
    expect(rig.applied).toHaveLength(0);
  });

  it("A4 keys typed in the code editor (.cm-editor) are ignored", async () => {
    const rig = talk();
    await flush();
    const cm = document.createElement("div");
    cm.className = "cm-editor";
    const content = document.createElement("div");
    content.className = "cm-content";
    content.setAttribute("contenteditable", "true");
    cm.append(content);
    rig.editor.append(cm);
    slideRows(rig)[0]!.click();
    const undo = press(content, "z", mod());
    const next = press(content, "PageDown");
    const fit = press(content, "0", mod());
    expect(undo.defaultPrevented).toBe(false);
    expect(next.defaultPrevented).toBe(false);
    expect(fit.defaultPrevented).toBe(false);
    expect(rig.calls.undo).toBe(0);
    expect(statusLeft(rig)).toMatch(/^Slide 1 of 4/);
  });

  it("A4 keys typed in the speaker notes box are ignored", async () => {
    const rig = talk();
    await flush();
    slideRows(rig)[0]!.click();
    const notes = rig.root.querySelector<HTMLTextAreaElement>("textarea")!;
    const event = press(notes, "PageDown");
    expect(event.defaultPrevented).toBe(false);
    expect(statusLeft(rig)).toMatch(/^Slide 1 of 4/);
  });

  it("A4 keys do nothing after dispose", async () => {
    const rig = talk();
    await flush();
    const root = rig.root;
    rig.workspace.dispose();
    expect(press(root, "z", mod()).defaultPrevented).toBe(false);
    expect(rig.calls.undo).toBe(0);
  });
});

describe("insert buttons never wait for a selection", () => {
  const ELEMENTS = ["Text", "Figure", "Equation", "Table", "List"];
  const insertButton = (rig: Rig, label: string): HTMLButtonElement => button(rig.root.querySelector('.dw-code-bar')!, label);

  it("A4 a talk with nothing selected has every element button enabled", async () => {
    const rig = talk();
    await flush();
    for (const label of ELEMENTS) expect([label, insertButton(rig, label).disabled]).toEqual([label, false]);
  });

  it("A4 a poster with nothing selected has every element button enabled", async () => {
    const rig = poster();
    await flush();
    for (const label of ELEMENTS) expect([label, insertButton(rig, label).disabled]).toEqual([label, false]);
  });

  it("A4 Text with nothing selected in a talk inserts into the first slide, the current one", async () => {
    const rig = talk();
    await flush();
    insertButton(rig, "Text").click();
    await flush();
    expect(rig.applied).toHaveLength(1);
    const slide = readSourceDeckBlocks("latex", "talk", BEAMER)[0]!;
    const added = insertion(BEAMER, rig.text());
    expect(added).toBeDefined();
    expect(added!.at).toBeGreaterThanOrEqual(slide.range[0]);
    expect(added!.at).toBeLessThanOrEqual(BEAMER.indexOf("\\end{frame}", slide.range[0]));
  });

  it("A4 Text in a talk inserts into the slide that is current after PageDown", async () => {
    const rig = talk();
    await flush();
    press(rig.root, "PageDown");
    insertButton(rig, "Text").click();
    await flush();
    const slide = readSourceDeckBlocks("latex", "talk", BEAMER)[1]!;
    const added = insertion(BEAMER, rig.text());
    expect(added).toBeDefined();
    expect(added!.at).toBeGreaterThanOrEqual(slide.range[0]);
    expect(added!.at).toBeLessThanOrEqual(BEAMER.indexOf("\\end{frame}", slide.range[0]));
  });

  it("A4 Text in a talk inserts into the slide chosen in the structure panel", async () => {
    const rig = talk();
    await flush();
    rig.root.querySelectorAll<HTMLElement>('[aria-label="Slides"] [role="treeitem"]:not(.dw-preamble)')[2]!.click();
    insertButton(rig, "Text").click();
    await flush();
    const slide = readSourceDeckBlocks("latex", "talk", BEAMER)[2]!;
    const added = insertion(BEAMER, rig.text());
    expect(added).toBeDefined();
    expect(added!.at).toBeGreaterThanOrEqual(slide.range[0]);
    expect(added!.at).toBeLessThanOrEqual(BEAMER.indexOf("\\end{frame}", slide.range[0]));
  });

  it("A4 Text in a poster inserts into the selected block, the first one when the poster opens", async () => {
    const rig = poster();
    await flush();
    insertButton(rig, "Text").click();
    await flush();
    expect(rig.applied).toHaveLength(1);
    const first = sourceDeckUnits("poster", readSourceDeckBlocks("latex", "poster", TIKZ))[0]!.node;
    const added = insertion(TIKZ, rig.text());
    expect(added).toBeDefined();
    expect(added!.at).toBeGreaterThan(first.range[0]);
    expect(added!.at).toBeLessThanOrEqual(first.range[1]);
  });

  it("A4 the other element buttons insert too when nothing is selected", async () => {
    for (const label of ["Equation", "Table", "List"]) {
      const rig = poster();
      await flush();
      insertButton(rig, label).click();
      await flush();
      expect([label, rig.applied.length]).toEqual([label, 1]);
    }
  });

  it("A4 a talk with no slide disables the element buttons with 'Add a slide first'", async () => {
    const rig = mount("talks/empty/main.tex", EMPTY_TALK);
    await flush();
    for (const label of ELEMENTS) {
      const insert = insertButton(rig, label);
      expect([label, insert.disabled, insert.title]).toEqual([label, true, "Add a slide first"]);
    }
  });

  it("A4 a poster with no block disables the element buttons with 'Add a block first'", async () => {
    const rig = mount("posters/empty/main.tex", EMPTY_POSTER);
    await flush();
    for (const label of ELEMENTS) {
      const insert = insertButton(rig, label);
      expect([label, insert.disabled, insert.title]).toEqual([label, true, "Add a block first"]);
    }
  });

  it("A4 a poster with a column but no block disables the element buttons too", async () => {
    const rig = mount("posters/columns/main.tex", COLUMN_ONLY_POSTER);
    await flush();
    const insert = insertButton(rig, "Text");
    expect([insert.disabled, insert.title]).toEqual([true, "Add a block first"]);
  });
});
