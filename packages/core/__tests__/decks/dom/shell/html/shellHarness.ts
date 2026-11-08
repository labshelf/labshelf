// Spec 2.3: the harness of the HTML deck shell tests (shell.test.ts, shellKeysBare.test.ts): the sample decks, the jsdom srcdoc-frame shim and the DOM and event helpers.
// jsdom has no layout (the stage clientWidth is 0, so a fitted editor has scale 1) and does not load srcdoc frames, so a MutationObserver loads
// each srcdoc into its frame. Mod is held as Ctrl and Meta together so the platform does not matter.
// Importing this module registers the shims' beforeAll/afterAll and the editor-teardown afterEach in the importing test file.
import { applyDeckEdit } from "../../../../../src/decks/deckEdit";
import { parseDeck } from "../../../../../src/decks/deckParse";
import { openDeckWorkspace, type DeckEditorChange, type DeckWorkspaceController, type DeckWorkspaceOptions } from "../../../../../src/decks/dom/openDeckEditor";

export const THEME = ":root { --deck-bg: #ffffff; --deck-fg: #1a1a1a; }\n";
const HEAD = '<head>\n<meta charset="utf-8">\n<title>Talk</title>\n<link rel="stylesheet" href="theme.css" data-deck-theme>\n</head>';
const A = '<div data-block="a" style="left: 240px; top: 400px; width: 400px; height: 160px;"><p>Alpha</p></div>';
const B = '<div data-block="b" style="left: 1200px; top: 640px; width: 480px; height: 240px;"><p>Beta</p></div>';
const TITLE = '<div data-block="title" style="left: 120px; top: 80px; width: 1680px; height: 200px;"><h1>Title</h1></div>';
export const DECK = [
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
export const POSTER = [
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

// --- helpers -----------------------------------------------------------------------------------------------------------------------


export let host: HTMLElement;
export let workspace: DeckWorkspaceController | undefined;
export let bare: { destroy(): void } | undefined;
export const loadMath = jest.fn(async () => ({ renderMathSvg: () => '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>' }));

afterEach(() => {
  workspace?.destroy();
  bare?.destroy();
  workspace = undefined;
  bare = undefined;
  document.body.innerHTML = "";
});

export async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    loadSrcdocFrames();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export async function openWs(html: string = DECK, extra: Partial<DeckWorkspaceOptions> = {}) {
  host = document.createElement("div");
  document.body.append(host);
  const onChange = jest.fn<void, [DeckEditorChange]>();
  workspace = openDeckWorkspace(host, { title: "My talk", html, theme: THEME, resolveAsset: async (p: string) => `blob:asset/${p}`, loadMath, onChange, ...extra });
  await settle();
  return onChange;
}

export const root = (): HTMLElement => host.querySelector<HTMLElement>(".dw")!;
export const header = (): HTMLElement | null => host.querySelector<HTMLElement>("header.dw-header");
export const toolbarOf = (label: string): HTMLElement | null => host.querySelector<HTMLElement>(`[role='toolbar'][aria-label='${label}']`);
export const buttonIn = (scope: ParentNode | null, label: string): HTMLButtonElement | null =>
  Array.from(scope?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => b.getAttribute("aria-label") === label) ?? null;
export const headerButton = (label: string): HTMLButtonElement | null => buttonIn(header(), label);
export const zoomLabel = (): string => toolbarOf("Zoom")?.querySelector(".dw-zoom-label")?.textContent ?? "";
export const stage = (): HTMLElement => host.querySelector<HTMLElement>(".deck-editor-stage")!;
export const named = (label: string): HTMLElement | null =>
  Array.from(host.querySelectorAll<HTMLElement>("button, [role='button']")).find((el) => el.getAttribute("aria-label") === label) ?? null;
export const MOD: KeyboardEventInit = { ctrlKey: true, metaKey: true };

/** Dispatches a keydown on the stage and returns the event, so a test can see whether it was handled. */
export function press(k: string, init: KeyboardEventInit = {}, target: Element = stage()): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}
export const blockIds = (html: string, slide = 0) => parseDeck(html).model?.slides[slide]?.blocks.map((b) => b.id);
export const lastChange = (onChange: jest.Mock<void, [DeckEditorChange]>): DeckEditorChange => {
  const calls = onChange.mock.calls;
  if (calls.length === 0) throw new Error("onChange was not called");
  return calls[calls.length - 1]![0];
};
export const moveA = (left: number) => (html: string) => applyDeckEdit(html, { kind: "move", block: "a", left, top: 400 });
export const leftOfA = (html: string): number | undefined => parseDeck(html).model?.slides[0]?.blocks.find((b) => b.id === "a")?.rect?.left;

// --- A4: the shell around the editor ------------------------------------------------------------------------------------------------

export const setHost = (next: HTMLElement): void => { host = next; };
export const setWorkspace = (next: DeckWorkspaceController | undefined): void => { workspace = next; };
export const setBare = (next: { destroy(): void } | undefined): void => { bare = next; };

