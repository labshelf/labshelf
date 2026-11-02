/** @jest-environment jsdom */
/**
 * Spec 6.3: the deck source view — mountDeckSourceView on its own (text in, onChange out, setText, flush, readOnly) and the Source
 * toggle of openDeckEditor (source edits become Edit source changes, visual changes reach the source without echo). User edits are
 * CodeMirror transactions dispatched on the view with a userEvent, as typing gives; the debounce runs on real timers.
 * jsdom does not load srcdoc frames, so a MutationObserver loads each srcdoc into its frame. Editor helpers throw
 * `not implemented: …` when the Source toggle or view is absent, so a red run shows the behaviour is missing.
 */
import { EditorView } from "@codemirror/view";
import { parseDeck } from "../../../src/decks/deckParse";
import { openDeckEditor, type DeckEditorChange, type DeckEditorController } from "../../../src/decks/dom/openDeckEditor";
import { mountDeckSourceView, type DeckSourceView } from "../../../src/decks/dom/deckSourceView";

const THEME = ":root { --deck-bg: #ffffff; --deck-fg: #1a1a1a; }\n";
const DECK = [
  "<!doctype html>",
  '<html lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px">',
  '<head>\n<meta charset="utf-8">\n<title>Talk</title>\n<link rel="stylesheet" href="theme.css" data-deck-theme>\n</head>',
  "<body>",
  "<section data-slide>",
  '<div data-block="title" style="left: 120px; top: 80px; width: 1680px; height: 200px;"><h1>Title</h1></div>',
  '<div data-block="a" style="left: 240px; top: 400px; width: 400px; height: 160px;"><p>Alpha</p></div>',
  '<div data-block="b" style="left: 1200px; top: 640px; width: 480px; height: 240px;"><p>Beta</p></div>',
  "</section>",
  "<section data-slide>",
  '<div data-block="body" style="left: 120px; top: 320px; width: 1680px; height: 600px;"><p>Second.</p></div>',
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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    loadSrcdocFrames();
    await wait(10);
  }
}

let source: DeckSourceView | undefined;
let editor: DeckEditorController | undefined;

afterEach(() => {
  source?.destroy();
  source = undefined;
  editor?.destroy();
  editor = undefined;
  document.body.innerHTML = "";
});

/** Types `insert` over [from, to) as a user edit. */
function type(view: EditorView, from: number, to: number, insert: string): void {
  view.dispatch({ changes: { from, to, insert }, userEvent: "input.type" });
}

function mountSource(text: string = DECK, extra: { debounceMs?: number; readOnly?: boolean } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const onChange = jest.fn<void, [string]>();
  source = mountDeckSourceView(host, { text, onChange, ...extra });
  const view = EditorView.findFromDOM(host);
  if (!view) throw new Error("no EditorView in the source view host");
  return { host, view, onChange };
}

// --- 6.3a ---------------------------------------------------------------------------------------------------------------------------

describe("mountDeckSourceView", () => {
  it("6.3a shows the deck html in an editor named Deck source", () => {
    const { host, view } = mountSource();
    expect(view.state.doc.toString()).toBe(DECK);
    expect(source!.text()).toBe(DECK);
    expect(host.querySelector("[aria-label='Deck source']")).not.toBeNull();
  });

  it("6.3a a typed edit calls onChange once after 300 ms idle", async () => {
    const { view, onChange } = mountSource();
    type(view, 0, 0, "x");
    await wait(150);
    type(view, 1, 1, "y");
    await wait(200);
    expect(onChange).not.toHaveBeenCalled();
    await wait(250);
    expect(onChange.mock.calls).toEqual([[`xy${DECK}`]]);
    expect(source!.text()).toBe(`xy${DECK}`);
  });

  it("6.3a debounceMs sets the idle delay", async () => {
    const { view, onChange } = mountSource("abc", { debounceMs: 20 });
    type(view, 3, 3, "d");
    await wait(80);
    expect(onChange.mock.calls).toEqual([["abcd"]]);
  });

  it("6.3a flush runs a pending call now and only once", async () => {
    const { view, onChange } = mountSource("abc");
    type(view, 0, 1, "A");
    source!.flush();
    expect(onChange.mock.calls).toEqual([["Abc"]]);
    await wait(400);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("6.3a setText replaces the document without calling onChange", async () => {
    const { view, onChange } = mountSource();
    source!.setText("<p>replaced</p>");
    expect(view.state.doc.toString()).toBe("<p>replaced</p>");
    expect(source!.text()).toBe("<p>replaced</p>");
    source!.flush();
    await wait(400);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("6.3a setText keeps the cursor within the new document", () => {
    const { view } = mountSource();
    view.dispatch({ selection: { anchor: DECK.length } });
    source!.setText("short");
    const { anchor, head } = view.state.selection.main;
    expect(anchor).toBeLessThanOrEqual(5);
    expect(head).toBeLessThanOrEqual(5);
  });

  it("6.3a readOnly makes the editor state read-only", () => {
    const { view } = mountSource(DECK, { readOnly: true });
    expect(view.state.readOnly).toBe(true);
  });
});

// --- editor harness ---------------------------------------------------------------------------------------------------------------

let host: HTMLElement;

const loadMath = jest.fn(async () => ({ renderMathSvg: () => '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>' }));

async function open(html: string = DECK) {
  host = document.createElement("div");
  document.body.append(host);
  const onChange = jest.fn<void, [DeckEditorChange]>();
  editor = openDeckEditor(host, { html, theme: THEME, resolveAsset: async (p: string) => `blob:asset/${p}`, loadMath, onChange });
  await settle();
  return onChange;
}

function sourceToggle(): HTMLButtonElement {
  const bar = host.querySelector<HTMLElement>("[role='toolbar']");
  const found = Array.from(bar?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
    (b) => b.getAttribute("aria-label") === "Source" || (b.textContent ?? "").trim() === "Source",
  );
  if (!found) throw new Error('not implemented: the deck editor toolbar has no Source toggle');
  return found;
}
async function toggleSource(): Promise<void> {
  sourceToggle().click();
  await settle();
}
function sourceView(): EditorView {
  const view = EditorView.findFromDOM(host);
  if (!view) throw new Error("not implemented: the deck editor shows no source view");
  return view;
}
function box(id: string): HTMLElement {
  const found = Array.from(host.querySelectorAll<HTMLElement>("button, [role='button']")).find((el) => el.getAttribute("aria-label") === `Block ${id}`);
  if (!found) throw new Error(`no overlay box named "Block ${id}"`);
  return found;
}
const boxes = () => Array.from(host.querySelectorAll<HTMLElement>("button, [role='button']")).filter((el) => /^Block /.test(el.getAttribute("aria-label") ?? ""));
function pointer(type: string, target: Element, x: number, y: number): void {
  const view = target.ownerDocument.defaultView ?? window;
  target.dispatchEvent(new view.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
}
function key(target: Element, k: string): void {
  const view = target.ownerDocument.defaultView ?? window;
  target.dispatchEvent(new view.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
}
function stageText(id: string): string | undefined {
  const frame = Array.from(host.querySelectorAll("iframe")).find((f) => f.contentDocument?.querySelector(`[data-block="${id}"]`));
  return frame?.contentDocument?.querySelector(`[data-block="${id}"]`)?.textContent ?? undefined;
}
const changes = (onChange: jest.Mock<void, [DeckEditorChange]>) => onChange.mock.calls.map(([c]) => c);

/** Replaces the first occurrence of `from` in the source view with `to` as a user edit, then waits past the idle delay. */
async function editSource(from: string, to: string): Promise<void> {
  const view = sourceView();
  const at = view.state.doc.toString().indexOf(from);
  if (at < 0) throw new Error(`"${from}" is not in the source`);
  type(view, at, at + from.length, to);
  await wait(450);
  await settle();
}

// --- 6.3b ---------------------------------------------------------------------------------------------------------------------------

describe("openDeckEditor source view", () => {
  it("6.3b the Source toggle is aria-pressed and shows deck.html", async () => {
    await open();
    expect(sourceToggle().getAttribute("aria-pressed")).toBe("false");
    await toggleSource();
    expect(sourceToggle().getAttribute("aria-pressed")).toBe("true");
    expect(sourceView().state.doc.toString()).toBe(DECK);
  });

  it("6.3b a source edit gives one Edit source change and re-renders the stage", async () => {
    const onChange = await open();
    await toggleSource();
    await editSource("<p>Alpha</p>", "<p>Gamma</p>");
    const html = DECK.replace("<p>Alpha</p>", "<p>Gamma</p>");
    expect(changes(onChange)).toEqual([{ html, theme: THEME, label: "Edit source" }]);
    await toggleSource();
    expect(stageText("a")).toBe("Gamma");
  });

  it("6.3b a gesture on the stage updates the source text without an echo change", async () => {
    const onChange = await open();
    await toggleSource();
    await toggleSource();
    pointer("pointerdown", box("a"), 10, 10);
    pointer("pointerup", box("a"), 10, 10);
    pointer("click", box("a"), 10, 10);
    await settle();
    key(box("a"), "ArrowRight");
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    const moved = changes(onChange)[0]!.html;
    expect(parseDeck(moved).model?.slides[0]?.blocks.find((b) => b.id === "a")?.rect?.left).toBe(241);
    await toggleSource();
    expect(sourceView().state.doc.toString()).toBe(moved);
    await wait(450);
    expect(changes(onChange).map((c) => c.label)).toEqual(["Move block"]);
  });

  it("6.3b undo and setDocument update the source text without an echo change", async () => {
    const onChange = await open();
    await toggleSource();
    await editSource("<p>Alpha</p>", "<p>Gamma</p>");
    editor!.undo();
    await settle();
    expect(sourceView().state.doc.toString()).toBe(DECK);
    const other = DECK.replace("<p>Beta</p>", "<p>Delta</p>");
    editor!.setDocument(other, THEME);
    await settle();
    expect(sourceView().state.doc.toString()).toBe(other);
    await wait(450);
    expect(changes(onChange).map((c) => c.label)).toEqual(["Edit source", "Undo"]);
  });
});

// --- 6.3c ---------------------------------------------------------------------------------------------------------------------------

describe("openDeckEditor source problems", () => {
  it("6.3c a source that is no deck keeps the last good stage and shows the problem", async () => {
    const onChange = await open();
    await toggleSource();
    const view = sourceView();
    type(view, 0, view.state.doc.length, "just some text");
    await wait(450);
    await settle();
    expect(parseDeck("just some text").model).toBeUndefined();
    expect(onChange).not.toHaveBeenCalled();
    expect(host.textContent).toContain("The source cannot be read as a deck: ");
    await toggleSource();
    expect(stageText("a")).toBe("Alpha");
    expect(boxes().map((b) => b.getAttribute("aria-label")).sort()).toEqual(["Block a", "Block b", "Block title"]);
  });

  it("6.3c a source with validation errors gives an Edit source change and makes the stage read-only", async () => {
    const onChange = await open();
    await toggleSource();
    await editSource('data-block="b"', 'data-block="Bad_Id"');
    expect(changes(onChange)).toEqual([{ html: DECK.replace('data-block="b"', 'data-block="Bad_Id"'), theme: THEME, label: "Edit source" }]);
    expect(host.textContent).toContain("This deck has errors and opens read-only.");
    await toggleSource();
    expect(boxes()).toHaveLength(0);
  });
});
