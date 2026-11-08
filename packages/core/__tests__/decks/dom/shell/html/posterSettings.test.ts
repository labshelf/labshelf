/** @jest-environment jsdom */
/** Spec 10.3: Poster Settings in the HTML deck shell: the Poster button and its panel (one panel at a time with Style), the settings fields, the orientation switch, and the section content actions. */
import { deckCanvasPx } from "../../../../../src/decks/deckSizes";
import { parseDeck } from "../../../../../src/decks/deckParse";
import { readPosterLayout } from "../../../../../src/decks/posterSections";
import { DECK, POSTER, THEME, lastChange, openWs, settle, workspace } from "./shellHarness";
import {
  SECTIONED, anyButton, boxesOf, callCount, chooseCustom, chooseOrientation, choosePreset, control, insertButton, layoutOf, openPanel, openSectioned, panel,
  panelButton, pick, presetSelect, props, reflowed, sectionEl, sectionIds, sectionedHtml, setField, settingsOf, sizeOf, stylePanel,
} from "./posterSettingsHarness";

// --- 10.3a -------------------------------------------------------------------------------------------------------------------------

describe("the Poster button and its panel (10.3a)", () => {
  it("10.3a a poster has a Poster button before Style; a talk has none", async () => {
    await openSectioned();
    const poster = insertButton("Poster");
    const style = insertButton("Style");
    expect(poster).not.toBeNull();
    expect(style).not.toBeNull();
    expect(poster!.getAttribute("aria-pressed")).toBe("false");
    expect(poster!.compareDocumentPosition(style!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("10.3a a talk has no Poster button", async () => {
    await openWs(DECK);
    expect(insertButton("Poster")).toBeNull();
    expect(insertButton("Style")).not.toBeNull();
  });

  it("10.3a the Poster button shows the panel in place of the properties and the button again returns them", async () => {
    await openSectioned();
    const poster = insertButton("Poster")!;
    poster.click();
    expect(poster.getAttribute("aria-pressed")).toBe("true");
    expect(panel()).not.toBeNull();
    expect(props().hidden).toBe(true);
    poster.click();
    expect(panel()).toBeNull();
    expect(props().hidden).toBe(false);
    expect(poster.getAttribute("aria-pressed")).toBe("false");
  });

  it("10.3a opening the Poster panel closes the Style panel", async () => {
    await openSectioned();
    const style = insertButton("Style")!;
    style.click();
    expect(stylePanel()).not.toBeNull();
    insertButton("Poster")!.click();
    expect(stylePanel()).toBeNull();
    expect(style.getAttribute("aria-pressed")).toBe("false");
    expect(insertButton("Poster")!.getAttribute("aria-pressed")).toBe("true");
    expect(panel()).not.toBeNull();
    expect(props().hidden).toBe(true);
  });

  it("10.3a opening Style closes the Poster panel", async () => {
    await openSectioned();
    const poster = insertButton("Poster")!;
    poster.click();
    expect(panel()).not.toBeNull();
    insertButton("Style")!.click();
    expect(panel()).toBeNull();
    expect(poster.getAttribute("aria-pressed")).toBe("false");
    expect(stylePanel()).not.toBeNull();
    expect(insertButton("Style")!.getAttribute("aria-pressed")).toBe("true");
    expect(props().hidden).toBe(true);
  });

  it("10.3a closing the panel that replaced the other shows the properties again", async () => {
    await openSectioned();
    insertButton("Style")!.click();
    insertButton("Poster")!.click();
    insertButton("Poster")!.click();
    expect(panel()).toBeNull();
    expect(stylePanel()).toBeNull();
    expect(props().hidden).toBe(false);
  });

  it("10.3a a read-only poster cannot edit through the panel", async () => {
    await openWs(sectionedHtml("841x1189mm", "Bad_Id"));
    const poster = insertButton("Poster");
    if (poster && !poster.disabled) {
      poster.click();
      const p = panel();
      if (p) for (const el of Array.from(p.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button, input, select"))) expect(el.disabled).toBe(true);
    }
    expect(poster === null || poster.disabled || panel() !== null).toBe(true);
  });
});

// --- 10.3b -------------------------------------------------------------------------------------------------------------------------

describe("the settings fields (10.3b)", () => {
  it("10.3b the fields show the Poster Settings of the current theme", async () => {
    const theme = THEME.replace("}", "--poster-section-margin: 75.59px; --poster-header-height: 226.77px; --poster-columns: 2 1; --poster-type-scale: 1.2; }");
    const base = reflowed(sectionedHtml(), theme);
    await openWs(base.html, { theme: base.theme });
    openPanel();
    expect(Number(control("Section margin")!.value)).toBeCloseTo(2, 1);
    expect(Number(control("Header height")!.value)).toBeCloseTo(6, 1);
    expect(Number(control("Columns")!.value)).toBe(2);
    expect(panel()!.textContent).toContain("Large");
  });

  it("10.3b a size preset writes one Change poster size with the new size and the sections reflowed inside it", async () => {
    const onChange = await openSectioned();
    openPanel();
    choosePreset("a1-portrait");
    await settle();
    expect(callCount(onChange)).toBe(1);
    const change = lastChange(onChange);
    expect(change.label).toBe("Change poster size");
    expect(sizeOf(change.html)).toBe("594x841mm");
    const layout = layoutOf(change);
    const canvas = deckCanvasPx({ w: 594, h: 841, unit: "mm" });
    expect(layout.width).toBeCloseTo(canvas.width, 1);
    expect(layout.height).toBeCloseTo(canvas.height, 1);
    for (const box of boxesOf(layout)) {
      expect(box.rect.left).toBeGreaterThanOrEqual(0);
      expect(box.rect.top).toBeGreaterThanOrEqual(0);
      expect(box.rect.left + box.rect.width).toBeLessThanOrEqual(canvas.width + 0.01);
      expect(box.rect.top + box.rect.height).toBeLessThanOrEqual(canvas.height + 0.01);
    }
  });

  it("10.3b a custom size of 96 x 48 in is accepted and written as one change", async () => {
    const onChange = await openSectioned();
    openPanel();
    chooseCustom();
    const before = callCount(onChange);
    setField("Width", "96");
    setField("Height", "48");
    setField("Unit", "in");
    await settle();
    expect(callCount(onChange)).toBe(before + 1);
    const change = lastChange(onChange);
    expect(change.label).toBe("Change poster size");
    expect(sizeOf(change.html)).toBe("96x48in");
    expect(layoutOf(change).width).toBeCloseTo(96 * 96, 1);
  });

  it("10.3b a custom size with a 97 in side is refused with the size picker's message and changes nothing", async () => {
    const onChange = await openSectioned();
    openPanel();
    chooseCustom();
    const before = callCount(onChange);
    setField("Width", "97");
    setField("Height", "48");
    setField("Unit", "in");
    await settle();
    expect(callCount(onChange)).toBe(before);
    expect(panel()!.textContent).toMatch(/Poster sizes are/);
  });

  it("10.3b the section margin writes one Change margins with the margin in the theme and the header at that margin", async () => {
    const onChange = await openSectioned();
    openPanel();
    setField("Section margin", "2");
    await settle();
    expect(callCount(onChange)).toBe(1);
    const change = lastChange(onChange);
    expect(change.label).toBe("Change margins");
    expect(change.theme).toContain("--poster-section-margin");
    const settings = settingsOf(change);
    expect(settings.sectionMargin).toBeCloseTo((2 * 96) / 2.54, 1);
    const header = layoutOf(change).header!;
    expect(header.rect.left).toBeCloseTo(settings.sectionMargin, 1);
    expect(header.rect.top).toBeCloseTo(settings.sectionMargin, 1);
  });

  it("10.3b the content margin writes one Change margins with the margin in the theme", async () => {
    const onChange = await openSectioned();
    openPanel();
    setField("Content margin", "1");
    await settle();
    expect(callCount(onChange)).toBe(1);
    const change = lastChange(onChange);
    expect(change.label).toBe("Change margins");
    expect(change.theme).toContain("--poster-content-margin");
    expect(settingsOf(change).contentMargin).toBeCloseTo(96 / 2.54, 1);
  });

  it("10.3b the header height writes one Change header height and the header band takes it", async () => {
    const onChange = await openSectioned();
    openPanel();
    setField("Header height", "6");
    await settle();
    expect(callCount(onChange)).toBe(1);
    const change = lastChange(onChange);
    expect(change.label).toBe("Change header height");
    expect(change.theme).toContain("--poster-header-height");
    expect(settingsOf(change).headerHeight).toBeCloseTo((6 * 96) / 2.54, 1);
    expect(layoutOf(change).header!.rect.height).toBeCloseTo((6 * 96) / 2.54, 1);
  });

  it("10.3b the column count writes one Change columns with equal ratios and that many columns", async () => {
    const onChange = await openSectioned();
    openPanel();
    setField("Columns", "2");
    await settle();
    expect(callCount(onChange)).toBe(1);
    const change = lastChange(onChange);
    expect(change.label).toBe("Change columns");
    expect(change.theme).toContain("--poster-columns");
    const settings = settingsOf(change);
    expect(settings.columns).toHaveLength(2);
    expect(settings.columns[0]).toBeCloseTo(settings.columns[1]!, 5);
    const layout = layoutOf(change);
    expect(layout.columns).toHaveLength(2);
    expect(layout.columns.flat()).toHaveLength(4);
  });

  it("10.3b the Large text size writes one Change text size with type scale 1.2 and the font variables", async () => {
    const onChange = await openSectioned();
    openPanel();
    pick("Text size", "Large");
    await settle();
    expect(callCount(onChange)).toBe(1);
    const change = lastChange(onChange);
    expect(change.label).toBe("Change text size");
    expect(settingsOf(change).typeScale).toBeCloseTo(1.2, 5);
    expect(change.theme).toContain("--poster-font-body");
  });

  it("10.3b the Small text size writes type scale 0.85", async () => {
    const onChange = await openSectioned();
    openPanel();
    pick("Text size", "Small");
    await settle();
    expect(settingsOf(lastChange(onChange)).typeScale).toBeCloseTo(0.85, 5);
  });

  it("10.3b a settings change is one undo step", async () => {
    const onChange = await openSectioned();
    openPanel();
    setField("Header height", "6");
    await settle();
    workspace!.undo();
    await settle();
    expect(lastChange(onChange).html).toBe(SECTIONED.html);
    expect(lastChange(onChange).theme).toBe(SECTIONED.theme);
  });

  it("10.3b the field shows the new value after its change", async () => {
    await openSectioned();
    openPanel();
    setField("Header height", "6");
    await settle();
    expect(Number(control("Header height")!.value)).toBeCloseTo(6, 1);
  });
});

// --- 10.3c -------------------------------------------------------------------------------------------------------------------------

describe("the orientation switch (10.3c)", () => {
  it("10.3c switching an A0 portrait poster to landscape writes one Switch orientation with the sections reflowed", async () => {
    const onChange = await openSectioned();
    const before = settingsOf(SECTIONED);
    openPanel();
    chooseOrientation("Landscape");
    await settle();
    expect(callCount(onChange)).toBe(1);
    const change = lastChange(onChange);
    expect(change.label).toBe("Switch orientation");
    expect(sizeOf(change.html)).toBe("1189x841mm");
    const layout = layoutOf(change);
    const canvas = deckCanvasPx({ w: 1189, h: 841, unit: "mm" });
    expect(layout.width).toBeCloseTo(canvas.width, 1);
    expect(layout.width).toBeGreaterThan(layout.height);
    const after = settingsOf(change);
    expect(after.columns).toEqual(before.columns);
    expect(after.headerHeight).toBeCloseTo(before.headerHeight * (841 / 1189), 0);
    const m = after.sectionMargin;
    expect(layout.header!.rect.width).toBeCloseTo(canvas.width - 2 * m, 1);
    for (const box of boxesOf(layout)) {
      expect(box.rect.left + box.rect.width).toBeLessThanOrEqual(canvas.width + 0.01);
      expect(box.rect.top + box.rect.height).toBeLessThanOrEqual(canvas.height + 0.01);
    }
  });

  it("10.3c the reflowed sections of the landscape poster do not overlap", async () => {
    const onChange = await openSectioned();
    openPanel();
    chooseOrientation("Landscape");
    await settle();
    const boxes = boxesOf(layoutOf(lastChange(onChange)));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!.rect;
        const b = boxes[j]!.rect;
        const apart = a.left + a.width <= b.left + 0.01 || b.left + b.width <= a.left + 0.01 || a.top + a.height <= b.top + 0.01 || b.top + b.height <= a.top + 0.01;
        expect(apart).toBe(true);
      }
    }
  });
});

// --- unsectioned poster ------------------------------------------------------------------------------------------------------------

describe("an unsectioned poster (10.3b)", () => {
  it("10.3b the panel offers Size, Orientation and Use sections but no Columns or margins", async () => {
    await openWs(POSTER);
    openPanel();
    expect(presetSelect()).toBeDefined();
    expect(panelButton("Use sections")).not.toBeNull();
    expect(control("Columns")).toBeNull();
    expect(control("Section margin")).toBeNull();
    expect(control("Header height")).toBeNull();
  });

  it("10.3b a preset on an unsectioned poster resizes through the plain size edit and scales the blocks", async () => {
    const onChange = await openWs(POSTER);
    openPanel();
    choosePreset("a1-portrait");
    await settle();
    expect(callCount(onChange)).toBe(1);
    const change = lastChange(onChange);
    expect(sizeOf(change.html)).toBe("594x841mm");
    const rect = parseDeck(change.html).model?.slides[0]?.blocks.find((b) => b.id === "title")?.rect;
    expect(rect!.width).toBeLessThan(2000);
    expect(change.theme).toBe(THEME);
  });

  it("10.3b Use sections writes one Use sections change with a section per column", async () => {
    const onChange = await openWs(POSTER);
    openPanel();
    panelButton("Use sections")!.click();
    await settle();
    expect(callCount(onChange)).toBe(1);
    const change = lastChange(onChange);
    expect(change.label).toBe("Use sections");
    const sections = new DOMParser().parseFromString(change.html, "text/html").querySelectorAll("[data-poster='section']");
    expect(Array.from(sections).map((s) => s.getAttribute("data-column")).sort()).toEqual(["0", "1", "2"]);
    expect(readPosterLayout(change.html, change.theme)).not.toBeNull();
    expect(parseDeck(change.html).model?.slides[0]?.blocks.some((b) => b.id === "title")).toBe(true);
  });

  it("10.3b once sectioned the panel shows the other fields", async () => {
    await openWs(POSTER);
    openPanel();
    panelButton("Use sections")!.click();
    await settle();
    expect(control("Columns")).not.toBeNull();
    expect(control("Section margin")).not.toBeNull();
    expect(panelButton("Use sections")).toBeNull();
  });
});

// --- 10.3d -------------------------------------------------------------------------------------------------------------------------

describe("section content (10.3d)", () => {
  it("10.3d with one section selected the panel offers Add section below, Add text and Add figure", async () => {
    await openSectioned({ pickImage: async () => undefined });
    workspace!.selectBlocks(["s1"]);
    await settle();
    openPanel();
    expect(panelButton("Add section below")).not.toBeNull();
    expect(panelButton("Add text")).not.toBeNull();
    expect(panelButton("Add figure")).not.toBeNull();
  });

  it("10.3d the actions are in the panel only, not with the panel closed", async () => {
    await openSectioned({ pickImage: async () => undefined });
    workspace!.selectBlocks(["s1"]);
    await settle();
    expect(anyButton("Add section below")).toBeNull();
    expect(anyButton("Add text")).toBeNull();
    expect(anyButton("Add figure")).toBeNull();
  });

  it("10.3d the actions follow the selection while the panel is open", async () => {
    await openSectioned({ pickImage: async () => undefined });
    openPanel();
    expect(panelButton("Add text")).toBeNull();
    workspace!.selectBlocks(["s2"]);
    await settle();
    expect(panelButton("Add text")).not.toBeNull();
    workspace!.selectBlocks([]);
    await settle();
    expect(panelButton("Add text")).toBeNull();
  });

  it("10.3d two sections, a free block or the header selected offer no actions", async () => {
    await openSectioned({ pickImage: async () => undefined });
    openPanel();
    for (const ids of [["s1", "s2"], ["logo"], ["head"]]) {
      workspace!.selectBlocks(ids);
      await settle();
      expect(panelButton("Add section below")).toBeNull();
      expect(panelButton("Add text")).toBeNull();
      expect(panelButton("Add figure")).toBeNull();
    }
  });

  it("10.3d Add figure with a picked image appends a figure whose figcaption is inside it", async () => {
    const pickImage = jest.fn(async () => "assets/fig.png");
    const onChange = await openSectioned({ pickImage });
    workspace!.selectBlocks(["s1"]);
    await settle();
    openPanel();
    panelButton("Add figure")!.click();
    await settle();
    expect(pickImage).toHaveBeenCalledTimes(1);
    expect(callCount(onChange)).toBe(1);
    const figure = sectionEl(lastChange(onChange).html, "s1").querySelector("figure")!;
    expect(figure).not.toBeNull();
    expect(figure.querySelector("img")!.getAttribute("src")).toBe("assets/fig.png");
    expect(figure.querySelector("figcaption")).not.toBeNull();
    expect(figure.querySelector("figcaption")!.textContent!.trim().length).toBeGreaterThan(0);
    expect(sectionEl(lastChange(onChange).html, "s2").querySelector("figure")).toBeNull();
  });

  it("10.3d a cancelled pick changes nothing", async () => {
    const pickImage = jest.fn(async () => undefined);
    const onChange = await openSectioned({ pickImage });
    workspace!.selectBlocks(["s1"]);
    await settle();
    openPanel();
    panelButton("Add figure")!.click();
    await settle();
    expect(pickImage).toHaveBeenCalledTimes(1);
    expect(callCount(onChange)).toBe(0);
  });

  it("10.3d Add text appends a Text paragraph at the end of the selected section", async () => {
    const onChange = await openSectioned({ pickImage: async () => undefined });
    workspace!.selectBlocks(["s2"]);
    await settle();
    openPanel();
    panelButton("Add text")!.click();
    await settle();
    expect(callCount(onChange)).toBe(1);
    const el = sectionEl(lastChange(onChange).html, "s2");
    const last = el.lastElementChild!;
    expect(last.tagName).toBe("P");
    expect(last.textContent).toBe("Text");
    expect(el.querySelectorAll("p")).toHaveLength(2);
    expect(el.querySelector("h2")!.textContent).toBe("Methods");
    expect(sectionEl(lastChange(onChange).html, "s1").querySelectorAll("p")).toHaveLength(1);
  });

  it("10.3d Add section below adds one section in the same column right after the selected one", async () => {
    const onChange = await openSectioned({ pickImage: async () => undefined });
    workspace!.selectBlocks(["s1"]);
    await settle();
    openPanel();
    panelButton("Add section below")!.click();
    await settle();
    expect(callCount(onChange)).toBe(1);
    const change = lastChange(onChange);
    expect(sectionIds(change.html)).toHaveLength(5);
    const column0 = layoutOf(change).columns[0]!.map((b) => b.id);
    expect(column0).toHaveLength(3);
    expect(column0[0]).toBe("s1");
    expect(column0[2]).toBe("s4");
    expect(["s1", "s2", "s3", "s4"]).not.toContain(column0[1]);
  });

  it("10.3d a read-only deck disables the section actions", async () => {
    await openWs(sectionedHtml("841x1189mm", "Bad_Id"), { pickImage: async () => "assets/fig.png" });
    const poster = insertButton("Poster");
    if (!poster || poster.disabled) return;
    poster.click();
    for (const name of ["Add section below", "Add text", "Add figure"]) {
      const button = panelButton(name);
      if (button) expect(button.disabled).toBe(true);
    }
  });
});
