/** @jest-environment jsdom */
/**
 * Spec 6.1: the slide strip — mountSlideStrip on its own (options in, onSelect and onEdit out, the DOM it builds) and inside
 * openDeckEditor in the deck shell's left panel (openDeckWorkspace: one change per strip edit, the selected slide, undo). jsdom does not load srcdoc frames, so a MutationObserver
 * loads each srcdoc into its frame's document and fires load, as the session 5 editor tests do. The math loader is a jest mock.
 * Editor helpers throw `not implemented: …` when the strip is absent, so a red run shows the behaviour is missing.
 */
import { applyDeckEdit, type DeckEdit as DeckEditType } from "../../../src/decks/deckEdit";
import { parseDeck } from "../../../src/decks/deckParse";
import { openDeckWorkspace, type DeckEditorChange, type DeckEditorController, type DeckWorkspaceOptions } from "../../../src/decks/dom/openDeckEditor";
import { mountSlideStrip, type SlideStrip, type SlideStripOptions } from "../../../src/decks/dom/slideStrip";

// The seam stubs `plan red` writes carry no imports; this global lets them compile. The real module imports its own type.
declare global {
  type DeckEdit = import("../../../src/decks/deckEdit").DeckEdit;
}

const THEME = ":root { --deck-bg: #ffffff; --deck-fg: #1a1a1a; }\n";
const HEAD = ["<head>", '<meta charset="utf-8">', "<title>Talk</title>", '<link rel="stylesheet" href="theme.css" data-deck-theme>', "</head>"].join("\n");
const talk = (slides: string[]): string =>
  [
    "<!doctype html>",
    '<html lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px">',
    HEAD,
    "<body>",
    ...slides.map((inner) => `<section data-slide>\n${inner}\n</section>`),
    "</body>",
    "</html>",
    "",
  ].join("\n");

const DECK = talk([
  '<div data-block="one" style="left: 120px; top: 80px; width: 1680px; height: 200px;"><h1>First</h1></div>',
  '<div data-block="two" style="left: 120px; top: 320px; width: 1680px; height: 600px;"><p>Second</p></div>',
  '<div data-block="three" style="left: 240px; top: 400px; width: 400px; height: 160px;"><p>Third</p></div>',
]);
const POSTER = [
  "<!doctype html>",
  '<html lang="en" data-deck="poster" data-deck-version="1" data-deck-size="841x1189mm">',
  HEAD,
  "<body>",
  "<section data-slide>",
  '<div data-block="title" style="left: 100px; top: 100px; width: 2000px; height: 300px;"><h1>Poster</h1></div>',
  "</section>",
  "</body>",
  "</html>",
  "",
].join("\n");

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

function key(target: Element, k: string, init: KeyboardEventInit = {}): void {
  const view = target.ownerDocument.defaultView ?? window;
  target.dispatchEvent(new view.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
}
// Mod is Meta on macOS and Ctrl elsewhere; both are held so the test does not depend on the platform jsdom reports.
const MOD: KeyboardEventInit = { ctrlKey: true, metaKey: true };

const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";

/** The accessible name of an element: aria-label, else its trimmed text. */
const nameOf = (el: Element): string => el.getAttribute("aria-label") ?? (el.textContent ?? "").trim();

function listboxIn(root: ParentNode): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>("[role='listbox']")).find((el) => el.getAttribute("aria-label") === "Slides") ?? null;
}
const optionsOf = (list: HTMLElement) => Array.from(list.querySelectorAll<HTMLElement>("[role='option']"));
function buttonIn(root: ParentNode, label: string): HTMLButtonElement | null {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button, [role='button']")).find((b) => nameOf(b) === label) ?? null;
}
const optionNamed = (option: HTMLElement, n: number): boolean => {
  const pattern = new RegExp(`(^|\\s)Slide ${n}(?!\\d)`);
  return pattern.test(nameOf(option)) || Array.from(option.querySelectorAll("img")).some((img) => img.getAttribute("alt") === `Slide ${n}`);
};

// --- strip harness ----------------------------------------------------------------------------------------------------------------

let stripHost: HTMLElement | undefined;
let strip: SlideStrip | undefined;

afterEach(() => {
  strip?.destroy();
  strip = undefined;
  editor?.destroy();
  editor = undefined;
  document.body.innerHTML = "";
});

const thumbUrl = (index: number) => `data:image/png;base64,THUMB${index}`;

async function mountStrip(over: Partial<SlideStripOptions> = {}) {
  stripHost = document.createElement("div");
  document.body.append(stripHost);
  const onSelect = jest.fn<void, [number]>();
  const onEdit = jest.fn<void, [DeckEditType, string]>();
  const thumbnail = jest.fn(async (index: number) => thumbUrl(index) as string | null);
  strip = mountSlideStrip(stripHost, { count: 3, current: 1, thumbnail, onSelect, onEdit, ...over });
  await settle();
  return { onSelect, onEdit, thumbnail };
}

function stripList(): HTMLElement {
  const list = listboxIn(stripHost!);
  if (!list) throw new Error("no listbox named Slides in the strip");
  return list;
}
function stripButton(label: string): HTMLButtonElement {
  const found = buttonIn(stripHost!, label);
  if (!found) throw new Error(`no strip button named "${label}"`);
  return found;
}
const currentOption = () => optionsOf(stripList()).find((o) => o.getAttribute("aria-selected") === "true")!;

// --- 6.1a strip ---------------------------------------------------------------------------------------------------------------------

describe("mountSlideStrip listing and selection", () => {
  it("6.1a lists one option per slide in a listbox named Slides, named Slide <n>", async () => {
    await mountStrip();
    const options = optionsOf(stripList());
    expect(options).toHaveLength(3);
    options.forEach((option, i) => expect(optionNamed(option, i + 1)).toBe(true));
  });

  it("6.1a marks only the current option aria-selected", async () => {
    await mountStrip();
    expect(optionsOf(stripList()).map((o) => o.getAttribute("aria-selected") === "true")).toEqual([false, true, false]);
  });

  it("6.1a each option shows its thumbnail as an img with alt Slide <n>", async () => {
    await mountStrip();
    optionsOf(stripList()).forEach((option, i) => {
      const img = option.querySelector("img");
      expect(img?.getAttribute("src")).toBe(thumbUrl(i));
      expect(img?.getAttribute("alt")).toBe(`Slide ${i + 1}`);
    });
  });

  it("6.1a a click on an option calls onSelect with its index", async () => {
    const { onSelect, onEdit } = await mountStrip();
    optionsOf(stripList())[2]!.click();
    expect(onSelect).toHaveBeenCalledWith(2);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("6.1a ArrowDown and ArrowUp select the next and the previous slide", async () => {
    const { onSelect, onEdit } = await mountStrip();
    key(currentOption(), "ArrowDown");
    expect(onSelect).toHaveBeenLastCalledWith(2);
    key(currentOption(), "ArrowUp");
    expect(onSelect).toHaveBeenLastCalledWith(0);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("6.1a update re-renders the options and the current one", async () => {
    await mountStrip();
    strip!.update(2, 0);
    await settle();
    const options = optionsOf(stripList());
    expect(options).toHaveLength(2);
    expect(options.map((o) => o.getAttribute("aria-selected") === "true")).toEqual([true, false]);
  });
});

// --- 6.1b strip ---------------------------------------------------------------------------------------------------------------------

describe("mountSlideStrip edits", () => {
  it("6.1b Add slide gives one addSlide edit labelled Add slide", async () => {
    const { onEdit } = await mountStrip();
    stripButton("Add slide").click();
    expect(onEdit).toHaveBeenCalledTimes(1);
    const [edit, label] = onEdit.mock.calls[0]!;
    expect(edit.kind).toBe("addSlide");
    expect(label).toBe("Add slide");
  });

  it("6.1b Duplicate slide gives duplicateSlide of the current slide labelled Duplicate slide", async () => {
    const { onEdit } = await mountStrip();
    stripButton("Duplicate slide").click();
    expect(onEdit.mock.calls).toEqual([[{ kind: "duplicateSlide", slide: 1 }, "Duplicate slide"]]);
  });

  it("6.1b Mod+D duplicates the current slide", async () => {
    const { onEdit } = await mountStrip();
    key(currentOption(), "d", MOD);
    expect(onEdit.mock.calls).toEqual([[{ kind: "duplicateSlide", slide: 1 }, "Duplicate slide"]]);
  });

  it("6.1b Delete slide gives deleteSlide of the current slide labelled Delete slide", async () => {
    const { onEdit } = await mountStrip();
    stripButton("Delete slide").click();
    expect(onEdit.mock.calls).toEqual([[{ kind: "deleteSlide", slide: 1 }, "Delete slide"]]);
  });

  it("6.1b the Delete key deletes the current slide", async () => {
    const { onEdit } = await mountStrip();
    key(currentOption(), "Delete");
    expect(onEdit.mock.calls).toEqual([[{ kind: "deleteSlide", slide: 1 }, "Delete slide"]]);
  });

  it("6.1b Delete slide is disabled with one slide and the Delete key does nothing", async () => {
    const { onEdit } = await mountStrip({ count: 1, current: 0 });
    expect(isDisabled(stripButton("Delete slide"))).toBe(true);
    key(currentOption(), "Delete");
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("6.1b Alt+ArrowDown and Alt+ArrowUp move the current slide labelled Move slide", async () => {
    const { onEdit, onSelect } = await mountStrip();
    key(currentOption(), "ArrowDown", { altKey: true });
    key(currentOption(), "ArrowUp", { altKey: true });
    expect(onEdit.mock.calls).toEqual([
      [{ kind: "moveSlide", from: 1, to: 2 }, "Move slide"],
      [{ kind: "moveSlide", from: 1, to: 0 }, "Move slide"],
    ]);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

// --- 6.1d strip ---------------------------------------------------------------------------------------------------------------------

describe("mountSlideStrip fallback", () => {
  it("6.1d a null thumbnail shows a static sandboxed frame instead of an img", async () => {
    await mountStrip({ thumbnail: async (index: number) => (index === 1 ? null : thumbUrl(index)) });
    const options = optionsOf(stripList());
    expect(options[0]!.querySelector("img")?.getAttribute("src")).toBe(thumbUrl(0));
    const fallback = options[1]!;
    expect(fallback.querySelector("img")).toBeNull();
    const frame = fallback.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame!.hasAttribute("sandbox")).toBe(true);
    expect(frame!.getAttribute("sandbox") ?? "").not.toContain("allow-scripts");
  });
});

// --- editor harness ---------------------------------------------------------------------------------------------------------------

let host: HTMLElement;
let editor: DeckEditorController | undefined;

const loadMath = jest.fn(async () => ({ renderMathSvg: () => '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>' }));

async function open(html: string = DECK, extra: Partial<DeckWorkspaceOptions> = {}) {
  host = document.createElement("div");
  document.body.append(host);
  const onChange = jest.fn<void, [DeckEditorChange]>();
  editor = openDeckWorkspace(host, { title: "Talk", html, theme: THEME, resolveAsset: async (p: string) => `blob:asset/${p}`, loadMath, onChange, ...extra });
  await settle();
  return onChange;
}

function editorStrip(): HTMLElement {
  const list = listboxIn(host);
  if (!list) throw new Error("not implemented: the deck editor has no listbox named Slides");
  return list;
}
function editorStripButton(label: string): HTMLButtonElement {
  const found = buttonIn(host, label);
  if (!found) throw new Error(`not implemented: the deck editor has no button named "${label}"`);
  return found;
}
const editorCurrentOption = () => {
  const found = optionsOf(editorStrip()).find((o) => o.getAttribute("aria-selected") === "true");
  if (!found) throw new Error("not implemented: no strip option is aria-selected");
  return found;
};
function toolButton(label: string): HTMLButtonElement {
  const bar = host.querySelector<HTMLElement>("[role='toolbar'][aria-label='Insert']");
  const found = Array.from(bar?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => b.getAttribute("aria-label") === label);
  if (!found) throw new Error(`no toolbar button named "${label}"`);
  return found;
}
/** The stage frame: the iframe outside the strip. */
function stageFrame(): HTMLIFrameElement {
  const list = listboxIn(host);
  const frame = Array.from(host.querySelectorAll("iframe")).find((f) => !list || !list.contains(f));
  if (!frame) throw new Error("no stage frame");
  return frame;
}

const changes = (onChange: jest.Mock<void, [DeckEditorChange]>) => onChange.mock.calls.map(([c]) => c);
const lastChange = (onChange: jest.Mock<void, [DeckEditorChange]>): DeckEditorChange => {
  const all = changes(onChange);
  if (all.length === 0) throw new Error("onChange was not called");
  return all[all.length - 1]!;
};
const slideCount = (html: string) => parseDeck(html).model?.slides.length;
function edited(html: string, edit: DeckEditType): string {
  const result = applyDeckEdit(html, edit);
  if (!result.ok) throw new Error(result.error);
  return result.html;
}

// --- 6.1a editor --------------------------------------------------------------------------------------------------------------------

describe("openDeckEditor slide strip", () => {
  it("6.1a a talk shows a strip with one option per slide, the first selected", async () => {
    await open();
    const options = optionsOf(editorStrip());
    expect(options).toHaveLength(3);
    expect(options.map((o) => o.getAttribute("aria-selected") === "true")).toEqual([true, false, false]);
  });

  it("6.1a a click on an option shows that slide on the stage without a change", async () => {
    const onChange = await open();
    optionsOf(editorStrip())[2]!.click();
    await settle();
    expect(editor!.currentSlide()).toBe(2);
    expect(stageFrame().getAttribute("title")).toBe("Slide 3");
    expect(editorCurrentOption()).toBe(optionsOf(editorStrip())[2]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("6.1a ArrowDown in the strip selects the next slide", async () => {
    const onChange = await open();
    key(editorCurrentOption(), "ArrowDown");
    await settle();
    expect(editor!.currentSlide()).toBe(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("6.1a a talk has the strip and a poster has none", async () => {
    await open();
    expect(optionsOf(editorStrip())).toHaveLength(3);
    editor!.destroy();
    editor = undefined;
    document.body.innerHTML = "";
    await open(POSTER);
    expect(listboxIn(host)).toBeNull();
  });
});

// --- 6.1b editor --------------------------------------------------------------------------------------------------------------------

describe("openDeckEditor strip edits", () => {
  it("6.1b Add slide gives one Add slide change with one more slide and selects the new slide", async () => {
    const onChange = await open();
    editorStripButton("Add slide").click();
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    const change = lastChange(onChange);
    expect(change.label).toBe("Add slide");
    expect(change.theme).toBe(THEME);
    expect(slideCount(change.html)).toBe(4);
    const added = parseDeck(change.html).model!.slides.findIndex((s) => s.blocks.length === 0);
    expect(added).toBeGreaterThanOrEqual(0);
    expect(editor!.currentSlide()).toBe(added);
    expect(optionsOf(editorStrip())).toHaveLength(4);
  });

  it("6.1b Duplicate slide gives one Duplicate slide change and selects the copy", async () => {
    const onChange = await open();
    editorStripButton("Duplicate slide").click();
    await settle();
    expect(changes(onChange)).toEqual([{ html: edited(DECK, { kind: "duplicateSlide", slide: 0 }), theme: THEME, label: "Duplicate slide" }]);
    expect(editor!.currentSlide()).toBe(1);
  });

  it("6.1b Mod+D in the strip gives one Duplicate slide change", async () => {
    const onChange = await open();
    editor!.selectSlide(1);
    await settle();
    key(editorCurrentOption(), "d", MOD);
    await settle();
    expect(changes(onChange)).toEqual([{ html: edited(DECK, { kind: "duplicateSlide", slide: 1 }), theme: THEME, label: "Duplicate slide" }]);
    expect(editor!.currentSlide()).toBe(2);
  });

  it("6.1b Delete slide gives one Delete slide change and selects the previous slide", async () => {
    const onChange = await open();
    editor!.selectSlide(2);
    await settle();
    editorStripButton("Delete slide").click();
    await settle();
    expect(changes(onChange)).toEqual([{ html: edited(DECK, { kind: "deleteSlide", slide: 2 }), theme: THEME, label: "Delete slide" }]);
    expect(editor!.currentSlide()).toBe(1);
    expect(optionsOf(editorStrip())).toHaveLength(2);
  });

  it("6.1b deleting the first slide selects slide 0", async () => {
    const onChange = await open();
    editorStripButton("Delete slide").click();
    await settle();
    expect(changes(onChange)).toEqual([{ html: edited(DECK, { kind: "deleteSlide", slide: 0 }), theme: THEME, label: "Delete slide" }]);
    expect(editor!.currentSlide()).toBe(0);
  });

  it("6.1b Alt+ArrowDown gives one Move slide change and the moved slide stays selected", async () => {
    const onChange = await open();
    key(editorCurrentOption(), "ArrowDown", { altKey: true });
    await settle();
    expect(changes(onChange)).toEqual([{ html: edited(DECK, { kind: "moveSlide", from: 0, to: 1 }), theme: THEME, label: "Move slide" }]);
    expect(editor!.currentSlide()).toBe(1);
  });

  it("6.1b Alt+ArrowUp gives one Move slide change and the moved slide stays selected", async () => {
    const onChange = await open();
    editor!.selectSlide(2);
    await settle();
    key(editorCurrentOption(), "ArrowUp", { altKey: true });
    await settle();
    expect(changes(onChange)).toEqual([{ html: edited(DECK, { kind: "moveSlide", from: 2, to: 1 }), theme: THEME, label: "Move slide" }]);
    expect(editor!.currentSlide()).toBe(1);
  });

  it("6.1b Undo restores a deleted slide", async () => {
    const onChange = await open();
    editor!.selectSlide(1);
    await settle();
    editorStripButton("Delete slide").click();
    await settle();
    expect(slideCount(lastChange(onChange).html)).toBe(2);
    toolButton("Undo").click();
    await settle();
    expect(lastChange(onChange)).toEqual({ html: DECK, theme: THEME, label: "Undo" });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(optionsOf(editorStrip())).toHaveLength(3);
  });
});
