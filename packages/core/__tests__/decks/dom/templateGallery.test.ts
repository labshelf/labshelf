/** @jest-environment jsdom */
/**
 * Spec 5.2: mountDeckTemplateGallery — the controls it builds (Kind, Format, Title, Template cards, Size, Orientation, Palette, Cancel, Create),
 * the DeckTemplateChoice it hands to onCreate and the cancel and destroy paths. Controls are found by their aria-label and text.
 */
// These tests run Typst decks, which are off in the product.
jest.mock("../../../src/decks/typstDecks", () => ({ TYPST_DECKS_ENABLED: true }));
import { DEFAULT_DECK_STYLE } from "../../../src/decks/deckStyleTokens";
import { DECK_STYLE_PRESETS } from "../../../src/decks/deckStylePresets";
import { deckSizeOrientation, type DeckKind } from "../../../src/decks/deckSizes";
import { listDeckTemplates, listTemplateSizes, type DeckTemplateChoice, type DeckTemplateFormat } from "../../../src/decks/deckTemplates";
import type { DeckKit } from "../../../src/decks/deckKit";
import { mountDeckTemplateGallery } from "../../../src/decks/dom/templateGallery";

interface Mounted {
  host: HTMLElement;
  element: HTMLElement;
  destroy(): void;
  onCreate: jest.Mock<void, [DeckTemplateChoice]>;
  onCancel: jest.Mock<void, []>;
}

const KIT: DeckKit = { name: "Lab", style: { ...DEFAULT_DECK_STYLE, primary: "#112233", accent: "#445566", background: "#fafafa", text: "#101010" } };
const A0_PORTRAIT = { w: 841, h: 1189, unit: "mm" };
const A0_LANDSCAPE = { w: 1189, h: 841, unit: "mm" };

function mount(init: { kind?: DeckKind; formats?: DeckTemplateFormat[]; kits?: DeckKit[] } = {}): Mounted {
  const host = document.createElement("div");
  document.body.append(host);
  const onCreate = jest.fn<void, [DeckTemplateChoice]>();
  const onCancel = jest.fn<void, []>();
  const gallery = mountDeckTemplateGallery(host, {
    ...(init.kind ? { kind: init.kind } : {}),
    formats: init.formats ?? ["html"],
    kits: init.kits ?? [],
    onCreate,
    onCancel,
  });
  return { host, element: gallery.element, destroy: () => gallery.destroy(), onCreate, onCancel };
}

afterEach(() => { document.body.innerHTML = ""; });

const group = (m: Mounted, label: string): HTMLElement | null => m.host.querySelector<HTMLElement>(`[aria-label="${label}"]`);
const text = (el: Element): string => (el.textContent ?? "").replace(/\s+/g, " ").trim();

function buttons(m: Mounted, label: string): HTMLButtonElement[] {
  const g = group(m, label);
  if (!g) throw new Error(`no group "${label}"`);
  return Array.from(g.querySelectorAll<HTMLButtonElement>("button"));
}

function button(m: Mounted, groupLabel: string, name: string): HTMLButtonElement {
  const all = buttons(m, groupLabel);
  const found = all.find((b) => b.getAttribute("aria-label") === name) ?? all.find((b) => text(b) === name) ?? all.find((b) => text(b).includes(name));
  if (!found) throw new Error(`no button "${name}" in "${groupLabel}"`);
  return found;
}

const pressed = (b: HTMLElement): boolean => b.getAttribute("aria-pressed") === "true";
const pressedNames = (m: Mounted, label: string): string[] => buttons(m, label).filter(pressed).map((b) => b.getAttribute("aria-label") ?? text(b));
const templateNames = (m: Mounted): string[] => buttons(m, "Template").map((b) => b.getAttribute("aria-label") ?? "");

const titleInput = (m: Mounted): HTMLInputElement => {
  const input = m.host.querySelector<HTMLInputElement>('input[aria-label="Title"]');
  if (!input) throw new Error("no Title input");
  return input;
};
const typeTitle = (m: Mounted, value: string): void => {
  const input = titleInput(m);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const topButton = (m: Mounted, label: string): HTMLButtonElement => {
  const found = Array.from(m.host.querySelectorAll<HTMLButtonElement>("button")).find((b) => text(b) === label || b.getAttribute("aria-label") === label);
  if (!found) throw new Error(`no ${label} button`);
  return found;
};
const sizeSelect = (m: Mounted): HTMLSelectElement => {
  const select = m.host.querySelector<HTMLSelectElement>('select[aria-label="Size"]');
  if (!select) throw new Error("no Size select");
  return select;
};
const sizeLabels = (m: Mounted): string[] => Array.from(sizeSelect(m).options).map((o) => text(o));
const selectedSize = (m: Mounted): string => text(sizeSelect(m).selectedOptions[0]!);
function chooseSize(m: Mounted, label: string): void {
  const select = sizeSelect(m);
  const option = Array.from(select.options).find((o) => text(o) === label);
  if (!option) throw new Error(`no size "${label}"`);
  select.value = option.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}
const pressEscape = (target: Element): void => { target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); };
const pressEnter = (target: Element): void => { target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); };
const labelsOf = (kind: DeckKind, format: DeckTemplateFormat, orientation: "portrait" | "landscape"): string[] =>
  listTemplateSizes(kind, format).filter((p) => deckSizeOrientation(p.size) !== (orientation === "portrait" ? "landscape" : "portrait")).map((p) => p.label);

describe("5.2a the gallery controls", () => {
  it("5.2a headed 'New talk or poster' with a Kind group of Presentation and Poster when no kind is given", () => {
    const m = mount();
    expect(text(m.element)).toContain("New talk or poster");
    expect(buttons(m, "Kind").map(text)).toEqual(["Presentation", "Poster"]);
    expect(pressedNames(m, "Kind")).toEqual(["Presentation"]);
  });

  it("5.2a a given kind is named in the heading, drops the Kind group and sets the Title placeholder", () => {
    const talk = mount({ kind: "talk" });
    expect(text(talk.element)).toContain("New presentation");
    expect(group(talk, "Kind")).toBeNull();
    expect(titleInput(talk).placeholder).toBe("Presentation title");
    const poster = mount({ kind: "poster" });
    expect(text(poster.element)).toContain("New poster");
    expect(group(poster, "Kind")).toBeNull();
    expect(titleInput(poster).placeholder).toBe("Poster title");
  });

  it("5.2a Format shows Visual, LaTeX or Typst with the first pressed, and is absent for one format", () => {
    const two = mount({ formats: ["html", "latex"] });
    expect(buttons(two, "Format").map(text)).toEqual(["Visual", "LaTeX"]);
    expect(pressedNames(two, "Format")).toEqual(["Visual"]);
    const typst = mount({ formats: ["html", "typst"] });
    expect(buttons(typst, "Format").map(text)).toEqual(["Visual", "Typst"]);
    const one = mount({ formats: ["html"] });
    expect(group(one, "Format")).toBeNull();
  });

  it("5.2a a talk lists Blank then Generic cards with Generic pressed, each with a preview and a description", () => {
    const m = mount();
    expect(templateNames(m)).toEqual(listDeckTemplates("talk", "html").map((t) => t.name));
    expect(templateNames(m)).toEqual(["Blank", "Generic"]);
    expect(pressedNames(m, "Template")).toEqual(["Generic"]);
    for (const card of buttons(m, "Template")) {
      expect(card.querySelector(".dtg-preview")).not.toBeNull();
    }
    const generic = listDeckTemplates("talk", "html").find((t) => t.id === "generic")!;
    expect(text(button(m, "Template", "Generic"))).toContain(generic.description);
  });

  it("5.2a a poster lists Blank, Generic, Better Poster and Billboard with Generic pressed", () => {
    const m = mount({ kind: "poster" });
    expect(templateNames(m)).toEqual(["Blank", "Generic", "Better Poster", "Billboard"]);
    expect(pressedNames(m, "Template")).toEqual(["Generic"]);
  });

  it("5.2a a talk defaults to the 16:9 size and has no Orientation group", () => {
    const m = mount({ kind: "talk" });
    expect(sizeLabels(m)).toEqual(listTemplateSizes("talk", "html").map((p) => p.label));
    expect(selectedSize(m)).toBe("16:9");
    expect(group(m, "Orientation")).toBeNull();
  });

  it("5.2a a poster has Orientation with Portrait pressed first and defaults to A0 portrait listing only portrait and square sizes", () => {
    const m = mount({ kind: "poster" });
    expect(buttons(m, "Orientation").map(text)).toEqual(["Portrait", "Landscape"]);
    expect(pressedNames(m, "Orientation")).toEqual(["Portrait"]);
    expect(selectedSize(m)).toBe("A0 portrait");
    expect(sizeLabels(m)).toEqual(labelsOf("poster", "html", "portrait"));
    expect(sizeLabels(m)).not.toContain("A0 landscape");
  });

  it("5.2a Palette lists Default pressed first, one button per Style preset, and no 'Your kits' heading without kits", () => {
    const m = mount();
    const names = buttons(m, "Palette").map((b) => b.getAttribute("aria-label") ?? text(b));
    expect(names[0]).toBe("Default");
    expect(pressedNames(m, "Palette")).toEqual(["Default"]);
    for (const preset of DECK_STYLE_PRESETS) expect(names.some((n) => n.includes(preset.name))).toBe(true);
    expect(text(m.element)).not.toContain("Your kits");
    expect(m.host.querySelector('[aria-label^="Kit:"]')).toBeNull();
  });

  it("5.2a Palette adds a 'Your kits' heading and a 'Kit: <name>' button per kit", () => {
    const other: DeckKit = { name: "Dept", style: { ...DEFAULT_DECK_STYLE, primary: "#aa0000" } };
    const m = mount({ kits: [KIT, other] });
    expect(text(m.element)).toContain("Your kits");
    expect(m.host.querySelector('[aria-label="Kit: Lab"]')).not.toBeNull();
    expect(m.host.querySelector('[aria-label="Kit: Dept"]')).not.toBeNull();
  });

  it("5.2a changing kind keeps the pressed template when it exists in the new kind and falls back to Generic otherwise", () => {
    const m = mount();
    button(m, "Template", "Blank").click();
    button(m, "Kind", "Poster").click();
    expect(templateNames(m)).toEqual(["Blank", "Generic", "Better Poster", "Billboard"]);
    expect(pressedNames(m, "Template")).toEqual(["Blank"]);
    expect(titleInput(m).placeholder).toBe("Poster title");
    button(m, "Template", "Better Poster").click();
    button(m, "Kind", "Presentation").click();
    expect(templateNames(m)).toEqual(["Blank", "Generic"]);
    expect(pressedNames(m, "Template")).toEqual(["Generic"]);
    expect(titleInput(m).placeholder).toBe("Presentation title");
  });

  it("5.2a the pressed palette colours the template previews", () => {
    const forest = DECK_STYLE_PRESETS.find((p) => p.name === "Forest")!;
    const m = mount({ kind: "poster" });
    button(m, "Palette", "Forest").click();
    const rgb = (hex: string): string => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
    const preview = button(m, "Template", "Better Poster").querySelector(".dtg-preview")!;
    // The colour sits in the preview, below it or on an ancestor up to the card.
    const styles: string[] = [];
    for (let el: Element | null = preview; el && el !== m.element; el = el.parentElement) styles.push(el.getAttribute("style") ?? "");
    preview.querySelectorAll("[style]").forEach((el) => styles.push(el.getAttribute("style") ?? ""));
    const joined = styles.join(";").toLowerCase();
    expect(joined.includes(forest.style.primary.toLowerCase()) || joined.includes(rgb(forest.style.primary))).toBe(true);
  });
});

describe("5.2b Create hands over the choice", () => {
  it("5.2b Create is disabled while the trimmed title is empty and enabled once it has text", () => {
    const m = mount();
    const create = topButton(m, "Create");
    expect(create.disabled).toBe(true);
    typeTitle(m, "   ");
    expect(create.disabled).toBe(true);
    typeTitle(m, "My talk");
    expect(create.disabled).toBe(false);
    typeTitle(m, "");
    expect(create.disabled).toBe(true);
  });

  it("5.2b a default talk gives talk, html, generic, the trimmed title, 16:9 and style null", () => {
    const m = mount();
    typeTitle(m, "  My talk  ");
    topButton(m, "Create").click();
    expect(m.onCreate).toHaveBeenCalledTimes(1);
    expect(m.onCreate).toHaveBeenCalledWith({
      kind: "talk", format: "html", template: "generic", title: "My talk", size: { w: 1920, h: 1080, unit: "px" }, style: null,
    });
  });

  it("5.2b a Better Poster with a preset gives the preset's style and A0 portrait", () => {
    const forest = DECK_STYLE_PRESETS.find((p) => p.name === "Forest")!;
    const m = mount({ kind: "poster" });
    button(m, "Template", "Better Poster").click();
    button(m, "Palette", "Forest").click();
    typeTitle(m, "Big result");
    topButton(m, "Create").click();
    expect(m.onCreate).toHaveBeenCalledTimes(1);
    expect(m.onCreate).toHaveBeenCalledWith({
      kind: "poster", format: "html", template: "better-poster", title: "Big result", size: A0_PORTRAIT, style: forest.style,
    });
  });

  it("5.2b a Kit gives the Kit's style", () => {
    const m = mount({ kits: [KIT] });
    button(m, "Palette", "Kit: Lab").click();
    typeTitle(m, "Kit talk");
    topButton(m, "Create").click();
    expect(m.onCreate.mock.calls[0]![0].style).toEqual(KIT.style);
  });

  it("5.2b choosing Default again after a preset gives style null", () => {
    const m = mount();
    button(m, "Palette", "Forest").click();
    button(m, "Palette", "Default").click();
    expect(pressedNames(m, "Palette")).toEqual(["Default"]);
    typeTitle(m, "Plain");
    topButton(m, "Create").click();
    expect(m.onCreate.mock.calls[0]![0].style).toBeNull();
  });

  it("5.2b Enter in the title creates once when the title is filled", () => {
    const m = mount();
    typeTitle(m, "Enter talk");
    pressEnter(titleInput(m));
    expect(m.onCreate).toHaveBeenCalledTimes(1);
    expect(m.onCreate.mock.calls[0]![0].title).toBe("Enter talk");
  });

  it("5.2b Enter with an empty title creates nothing", () => {
    const m = mount();
    pressEnter(titleInput(m));
    typeTitle(m, "  ");
    pressEnter(titleInput(m));
    expect(m.onCreate).not.toHaveBeenCalled();
  });

  it("5.2b a chosen size and template are in the choice", () => {
    const m = mount({ kind: "talk" });
    button(m, "Template", "Blank").click();
    chooseSize(m, "4:3");
    typeTitle(m, "Old school");
    topButton(m, "Create").click();
    expect(m.onCreate).toHaveBeenCalledWith({
      kind: "talk", format: "html", template: "blank", title: "Old school", size: { w: 1440, h: 1080, unit: "px" }, style: null,
    });
  });

  it("5.2b the chosen format is in the choice", () => {
    const m = mount({ kind: "talk", formats: ["html", "latex"] });
    button(m, "Format", "LaTeX").click();
    expect(pressedNames(m, "Format")).toEqual(["LaTeX"]);
    typeTitle(m, "Beamer");
    topButton(m, "Create").click();
    expect(m.onCreate.mock.calls[0]![0]).toMatchObject({ kind: "talk", format: "latex", template: "generic", title: "Beamer", style: null });
  });
});

describe("5.2c orientation and format change the size list", () => {
  it("5.2c switching to Landscape lists landscape presets and keeps the A0 paper", () => {
    const m = mount({ kind: "poster" });
    button(m, "Orientation", "Landscape").click();
    expect(pressedNames(m, "Orientation")).toEqual(["Landscape"]);
    expect(sizeLabels(m)).toEqual(labelsOf("poster", "html", "landscape"));
    expect(sizeLabels(m)).not.toContain("A0 portrait");
    expect(selectedSize(m)).toBe("A0 landscape");
    typeTitle(m, "Wide");
    topButton(m, "Create").click();
    expect(m.onCreate.mock.calls[0]![0].size).toEqual(A0_LANDSCAPE);
  });

  it("5.2c switching to Landscape keeps another chosen paper", () => {
    const m = mount({ kind: "poster" });
    chooseSize(m, "A1 portrait");
    button(m, "Orientation", "Landscape").click();
    expect(selectedSize(m)).toBe("A1 landscape");
    button(m, "Orientation", "Portrait").click();
    expect(selectedSize(m)).toBe("A1 portrait");
  });

  it("5.2c switching a poster to LaTeX lists only the A0 to A2 sizes of the pressed orientation", () => {
    const m = mount({ kind: "poster", formats: ["html", "latex"] });
    button(m, "Format", "LaTeX").click();
    expect(sizeLabels(m)).toEqual(["A0 portrait", "A1 portrait", "A2 portrait"]);
    button(m, "Orientation", "Landscape").click();
    expect(sizeLabels(m)).toEqual(["A0 landscape", "A1 landscape", "A2 landscape"]);
  });

  it("5.2c switching a talk to LaTeX lists only 16:9 and 4:3", () => {
    const m = mount({ kind: "talk", formats: ["html", "latex"] });
    button(m, "Format", "LaTeX").click();
    expect(sizeLabels(m)).toEqual(["16:9", "4:3"]);
  });

  it("5.2c a LaTeX poster created in landscape gives an A-series size", () => {
    const m = mount({ kind: "poster", formats: ["html", "latex"] });
    button(m, "Format", "LaTeX").click();
    button(m, "Orientation", "Landscape").click();
    typeTitle(m, "Paper");
    topButton(m, "Create").click();
    expect(m.onCreate.mock.calls[0]![0]).toMatchObject({ format: "latex", size: A0_LANDSCAPE });
  });

  it("5.2c the template stays pressed across a format change when it still exists", () => {
    const m = mount({ kind: "poster", formats: ["html", "typst"] });
    button(m, "Template", "Billboard").click();
    button(m, "Format", "Typst").click();
    expect(pressedNames(m, "Template")).toEqual(["Billboard"]);
  });
});

describe("5.2d cancel and destroy", () => {
  it("5.2d Cancel calls onCancel and not onCreate", () => {
    const m = mount();
    topButton(m, "Cancel").click();
    expect(m.onCancel).toHaveBeenCalledTimes(1);
    expect(m.onCreate).not.toHaveBeenCalled();
  });

  it("5.2d Escape on the gallery calls onCancel", () => {
    const m = mount();
    pressEscape(titleInput(m));
    expect(m.onCancel).toHaveBeenCalledTimes(1);
    expect(m.onCreate).not.toHaveBeenCalled();
  });

  it("5.2d destroy removes the element from the page", () => {
    const m = mount();
    expect(m.host.contains(m.element)).toBe(true);
    m.destroy();
    expect(m.host.contains(m.element)).toBe(false);
    expect(m.host.querySelector(".dtg")).toBeNull();
  });

  it("5.2d after destroy Escape and Enter no longer call back", () => {
    const m = mount();
    const input = titleInput(m);
    typeTitle(m, "Gone");
    m.destroy();
    pressEscape(input);
    pressEscape(document.body);
    pressEnter(input);
    expect(m.onCancel).not.toHaveBeenCalled();
    expect(m.onCreate).not.toHaveBeenCalled();
  });
});
