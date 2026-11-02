/** @jest-environment jsdom */
/**
 * Spec 6.2: the size picker — mountSizePicker on its own (kind and size in, onApply out, the controls it builds) and the Size popover
 * of openDeckEditor (one Change size change). Controls are found by role and accessible name (aria-label, else label or text).
 * Editor helpers throw `not implemented: …` when the Size control is absent, so a red run shows the behaviour is missing.
 */
import { applyDeckEdit } from "../../../src/decks/deckEdit";
import { parseDeck } from "../../../src/decks/deckParse";
import { listDeckSizePresets, type DeckKind as Kind, type DeckSize as Size } from "../../../src/decks/deckSizes";
import { openDeckEditor, type DeckEditorChange, type DeckEditorController } from "../../../src/decks/dom/openDeckEditor";
import { mountSizePicker } from "../../../src/decks/dom/sizePicker";

// The seam stubs `plan red` writes carry no imports; these globals let them compile. The real module imports its own types.
declare global {
  type DeckKind = import("../../../src/decks/deckSizes").DeckKind;
  type DeckSize = import("../../../src/decks/deckSizes").DeckSize;
}

const THEME = ":root { --deck-bg: #ffffff; }\n";
const DECK = [
  "<!doctype html>",
  '<html lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px">',
  '<head>\n<meta charset="utf-8">\n<title>Talk</title>\n<link rel="stylesheet" href="theme.css" data-deck-theme>\n</head>',
  "<body>",
  "<section data-slide>",
  '<div data-block="title" style="left: 120px; top: 80px; width: 1680px; height: 200px;"><h1>Title</h1></div>',
  "</section>",
  "</body>",
  "</html>",
  "",
].join("\n");

const TALK_MESSAGE = "Talk sizes are 320 to 7680 px per side.";
const POSTER_MESSAGE = "Poster sizes are 100 to 2000 mm (3.9 to 78.7 in) per side.";

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

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    loadSrcdocFrames();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

let picker: { readonly element: HTMLElement; destroy(): void } | undefined;
let editor: DeckEditorController | undefined;

afterEach(() => {
  picker?.destroy();
  picker = undefined;
  editor?.destroy();
  editor = undefined;
  document.body.innerHTML = "";
});

// --- accessible names -------------------------------------------------------------------------------------------------------------

function nameOf(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length > 0) return (labels[0]!.textContent ?? "").trim();
  const wrapping = el.closest("label");
  if (wrapping && wrapping !== el) return (wrapping.textContent ?? "").trim();
  return (el.textContent ?? "").trim();
}
const radios = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLInputElement>("input[type='radio']"));
const CLICKABLE = "button, [role='button'], [role='radio'], [role='tab'], input[type='radio'], input[type='checkbox']";
function control(root: ParentNode, name: string | RegExp): HTMLElement | null {
  const matches = (el: Element) => (typeof name === "string" ? nameOf(el) === name : name.test(nameOf(el)));
  return Array.from(root.querySelectorAll<HTMLElement>(CLICKABLE)).find(matches) ?? null;
}
function need<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`no ${what}`);
  return value;
}
function textInput(root: ParentNode, name: RegExp): HTMLInputElement {
  return need(
    Array.from(root.querySelectorAll<HTMLInputElement>("input")).find((i) => i.type !== "radio" && i.type !== "checkbox" && name.test(nameOf(i))),
    `input named ${String(name)}`,
  );
}
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
const presetRadios = (root: ParentNode, kind: Kind) => {
  const labels = listDeckSizePresets(kind).map((p) => p.label);
  return radios(root).filter((r) => labels.includes(nameOf(r)));
};

function mountPicker(kind: Kind, size: Size) {
  const host = document.createElement("div");
  document.body.append(host);
  const onApply = jest.fn<void, [Size]>();
  picker = mountSizePicker(host, { kind, size, onApply });
  return { host, onApply };
}

function fillCustom(root: ParentNode, w: string, h: string, unit?: string): void {
  const custom = control(root, /^Custom/);
  if (custom) custom.click();
  setValue(textInput(root, /width/i), w);
  setValue(textInput(root, /height/i), h);
  if (unit !== undefined) setValue(need(root.querySelector<HTMLSelectElement>("select"), "unit select"), unit);
}
const apply = (root: ParentNode) => need(control(root, /^Apply/), "Apply button").click();

// --- 6.2b ---------------------------------------------------------------------------------------------------------------------------

describe("mountSizePicker presets", () => {
  it("6.2b a talk lists its D2 presets as radios with their labels, the current size checked", () => {
    const { host } = mountPicker("talk", { w: 1920, h: 1080, unit: "px" });
    const found = presetRadios(host, "talk");
    expect(found.map(nameOf)).toEqual(listDeckSizePresets("talk").map((p) => p.label));
    expect(found.filter((r) => r.checked).map(nameOf)).toEqual(["16:9"]);
  });

  it("6.2b a poster lists its D2 presets as radios with their labels", () => {
    const { host } = mountPicker("poster", { w: 594, h: 841, unit: "mm" });
    const found = presetRadios(host, "poster");
    expect(found.map(nameOf)).toEqual(listDeckSizePresets("poster").map((p) => p.label));
    expect(found.filter((r) => r.checked).map(nameOf)).toEqual(["A1 portrait"]);
  });

  it("6.2b Apply with a chosen preset calls onApply with its size", () => {
    const { host, onApply } = mountPicker("talk", { w: 1920, h: 1080, unit: "px" });
    need(presetRadios(host, "talk").find((r) => nameOf(r) === "4:3"), "4:3 radio").click();
    apply(host);
    expect(onApply.mock.calls).toEqual([[{ w: 1440, h: 1080, unit: "px" }]]);
  });

  it("6.2b a poster's Landscape toggle swaps the width and height of a portrait preset", () => {
    const { host, onApply } = mountPicker("poster", { w: 841, h: 1189, unit: "mm" });
    need(presetRadios(host, "poster").find((r) => nameOf(r) === "A1 portrait"), "A1 portrait radio").click();
    need(control(host, "Landscape"), "Landscape control").click();
    apply(host);
    expect(onApply.mock.calls).toEqual([[{ w: 841, h: 594, unit: "mm" }]]);
  });

  it("6.2b a talk has no orientation toggle", () => {
    const { host } = mountPicker("talk", { w: 1920, h: 1080, unit: "px" });
    expect(control(host, "Landscape")).toBeNull();
    expect(control(host, "Portrait")).toBeNull();
  });
});

describe("mountSizePicker custom sizes", () => {
  it("6.2b a talk's unit select offers px only and a poster's mm and in", () => {
    const talk = mountPicker("talk", { w: 1920, h: 1080, unit: "px" });
    const talkUnits = Array.from(need(talk.host.querySelector("select"), "talk unit select").options).map((o) => o.value);
    expect(talkUnits).toEqual(["px"]);
    picker!.destroy();
    picker = undefined;
    const poster = mountPicker("poster", { w: 841, h: 1189, unit: "mm" });
    const posterUnits = Array.from(need(poster.host.querySelector("select"), "poster unit select").options).map((o) => o.value);
    expect(posterUnits.sort()).toEqual(["in", "mm"]);
  });

  it("6.2b a custom talk size in range is applied", () => {
    const { host, onApply } = mountPicker("talk", { w: 1920, h: 1080, unit: "px" });
    fillCustom(host, "800", "600");
    apply(host);
    expect(onApply.mock.calls).toEqual([[{ w: 800, h: 600, unit: "px" }]]);
  });

  it("6.2b a custom poster size in inches in range is applied", () => {
    const { host, onApply } = mountPicker("poster", { w: 841, h: 1189, unit: "mm" });
    fillCustom(host, "30", "40", "in");
    apply(host);
    expect(onApply.mock.calls).toEqual([[{ w: 30, h: 40, unit: "in" }]]);
  });

  it("6.2b an out-of-range talk size is refused with the talk message", () => {
    const { host, onApply } = mountPicker("talk", { w: 1920, h: 1080, unit: "px" });
    expect(host.textContent).not.toContain(TALK_MESSAGE);
    fillCustom(host, "200", "600");
    apply(host);
    expect(onApply).not.toHaveBeenCalled();
    expect(host.textContent).toContain(TALK_MESSAGE);
  });

  it("6.2b an out-of-range poster size is refused with the poster message", () => {
    const { host, onApply } = mountPicker("poster", { w: 841, h: 1189, unit: "mm" });
    fillCustom(host, "50", "2500", "mm");
    apply(host);
    expect(onApply).not.toHaveBeenCalled();
    expect(host.textContent).toContain(POSTER_MESSAGE);
  });
});

// --- 6.2c ---------------------------------------------------------------------------------------------------------------------------

describe("openDeckEditor Size popover", () => {
  it("6.2c Apply gives one Change size change with the size written and block geometry scaled", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onChange = jest.fn<void, [DeckEditorChange]>();
    editor = openDeckEditor(host, { html: DECK, theme: THEME, resolveAsset: async (p: string) => `blob:asset/${p}`, onChange });
    await settle();
    const bar = host.querySelector<HTMLElement>("[role='toolbar']");
    const sizeButton = Array.from(bar?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => b.getAttribute("aria-label") === "Size");
    if (!sizeButton) throw new Error('not implemented: the deck editor toolbar has no button named "Size"');
    sizeButton.click();
    await settle();
    need(presetRadios(document, "talk").find((r) => nameOf(r) === "4:3"), "4:3 radio").click();
    apply(document);
    await settle();
    const expected = applyDeckEdit(DECK, { kind: "setSize", size: { w: 1440, h: 1080, unit: "px" }, scale: true });
    if (!expected.ok) throw new Error(expected.error);
    expect(onChange.mock.calls.map(([c]) => c)).toEqual([{ html: expected.html, theme: THEME, label: "Change size" }]);
    const model = parseDeck(expected.html).model!;
    expect(model.size).toEqual({ w: 1440, h: 1080, unit: "px" });
    expect(model.slides[0]!.blocks[0]!.rect).toEqual({ left: 90, top: 80, width: 1260, height: 200 });
  });
});
