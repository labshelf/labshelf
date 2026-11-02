/**
 * Shared harness for the openDeckEditor tests (spec 5.3): the sample decks, the jsdom srcdoc-frame shim, and the DOM and event helpers.
 * jsdom has no layout: the stage clientWidth is 0, so the editor's scale is 1 and pointer deltas are slide px. jsdom does not load
 * srcdoc frames, so a MutationObserver loads each srcdoc into the frame's document and fires load, as a browser would.
 * Importing this module registers the shims' beforeAll/afterAll and the editor-teardown afterEach in the importing test file.
 */
import { openDeckEditor, type DeckEditorChange, type DeckEditorController, type DeckEditorOptions } from "../../../src/decks/dom/openDeckEditor";
import { parseDeck, type DeckRect } from "../../../src/decks/deckParse";

export const THEME = ":root { --deck-bg: #ffffff; --deck-fg: #1a1a1a; }\n";
const HEAD = ["<head>", '<meta charset="utf-8">', "<title>Talk</title>", '<link rel="stylesheet" href="theme.css" data-deck-theme>', "</head>"].join("\n");
export const deck = (blocks: string): string =>
  [
    "<!doctype html>",
    '<html lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px">',
    HEAD,
    "<body>",
    "<section data-slide>",
    blocks,
    "</section>",
    "<section data-slide>",
    '<div data-block="body" style="left: 120px; top: 320px; width: 1680px; height: 600px;"><p>Second.</p><div data-math="display">\\frac{a}{b}</div></div>',
    "</section>",
    "</body>",
    "</html>",
    "",
  ].join("\n");

// Slide 1 of a 1920x1080 talk. Block a's moves below land on the 8 px grid and stay more than 6 px from every snap target.
export const DECK = deck(
  [
    '<div data-block="title" style="left: 120px; top: 80px; width: 1680px; height: 200px;"><h1>Title</h1></div>',
    '<div data-block="a" style="left: 240px; top: 400px; width: 400px; height: 160px;"><p>Alpha</p></div>',
    '<div data-block="b" style="left: 1200px; top: 640px; width: 480px; height: 240px;"><p>Beta</p></div>',
  ].join("\n"),
);
// DECK010: an invalid block id makes the deck open read-only.
export const INVALID = DECK.replace('data-block="b"', 'data-block="Bad_Id"');

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

// --- harness -----------------------------------------------------------------------------------------------------------------------

export let host: HTMLElement;
export let editor: DeckEditorController | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  document.body.innerHTML = "";
});

export async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    loadSrcdocFrames();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export const loadMath = jest.fn(async () => ({ renderMathSvg: () => '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>' }));

export async function open(html: string = DECK, extra: Partial<DeckEditorOptions> = {}) {
  host = document.createElement("div");
  document.body.append(host);
  const onChange = jest.fn<void, [DeckEditorChange]>();
  editor = openDeckEditor(host, {
    html,
    theme: THEME,
    resolveAsset: async (p: string) => `blob:asset/${p}`,
    loadMath,
    onChange,
    ...extra,
  });
  await settle();
  return onChange;
}

export const named = (label: string): HTMLElement | null =>
  Array.from(host.querySelectorAll<HTMLElement>("button, [role='button']")).find((el) => el.getAttribute("aria-label") === label) ?? null;
export function box(id: string): HTMLElement {
  const found = named(`Block ${id}`);
  if (!found) throw new Error(`no overlay box named "Block ${id}"`);
  return found;
}
export function handleOf(name: string): HTMLElement {
  const found = named(`Resize ${name}`);
  if (!found) throw new Error(`no handle named "Resize ${name}"`);
  return found;
}
export const boxes = () => Array.from(host.querySelectorAll<HTMLElement>("button, [role='button']")).filter((el) => /^Block /.test(el.getAttribute("aria-label") ?? ""));
export const toolbar = () => host.querySelector<HTMLElement>("[role='toolbar']");
export function toolButton(label: string): HTMLButtonElement {
  const found = Array.from(toolbar()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => b.getAttribute("aria-label") === label);
  if (!found) throw new Error(`no toolbar button named "${label}"`);
  return found;
}
export const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
export function frameDoc(): Document {
  const doc = host.querySelector("iframe")?.contentDocument;
  if (!doc) throw new Error("no frame document");
  return doc;
}
export const frameBlock = (id: string) => frameDoc().querySelector<HTMLElement>(`[data-block="${id}"]`);

export function pointer(type: string, target: Element, x: number, y: number, init: MouseEventInit = {}): void {
  const view = target.ownerDocument.defaultView ?? window;
  target.dispatchEvent(new view.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, ...init }));
}
export function key(target: Element, k: string, init: KeyboardEventInit = {}): void {
  const view = target.ownerDocument.defaultView ?? window;
  target.dispatchEvent(new view.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
}
// Mod is Meta on macOS and Ctrl elsewhere; both are held so the test does not depend on the platform jsdom reports.
export const MOD: KeyboardEventInit = { ctrlKey: true, metaKey: true };

/** Clicks a box without moving: selects it and changes nothing. */
export async function select(id: string): Promise<void> {
  pointer("pointerdown", box(id), 10, 10);
  pointer("pointerup", box(id), 10, 10);
  pointer("click", box(id), 10, 10);
  await settle();
}

export function rectOf(html: string, id: string): DeckRect | null | undefined {
  return parseDeck(html).model?.slides.flatMap((s) => s.blocks).find((b) => b.id === id)?.rect;
}
export const blockIds = (html: string, slide = 0) => parseDeck(html).model?.slides[slide]?.blocks.map((b) => b.id);
export const changes = (onChange: jest.Mock<void, [DeckEditorChange]>) => onChange.mock.calls.map(([c]) => c);
export const lastChange = (onChange: jest.Mock<void, [DeckEditorChange]>): DeckEditorChange => {
  const all = changes(onChange);
  if (all.length === 0) throw new Error("onChange was not called");
  return all[all.length - 1]!;
};

// --- 5.3a ---------------------------------------------------------------------------------------------------------------------------
