/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
/// <reference lib="dom" />
/// <reference path="../../../../src/webviewGlobals.d.ts" />
// Tests the editor page's side of an article's preview pane: the mount request, the split built on boot, setShown, the reader's channel and a single start.
import type { MessageEnd } from "@labshelf/core";
import { INLINE_PREVIEW_WIDTH_KEY, mountInlinePreview, withoutInlinePreview, type InlineReaderTransport } from "../../../../src/writing/sourceEditor/webview/inlinePreview";

// The core barrels load the whole editor; the pane needs only the split, the element helper, the reader's shell and the deck kind.
jest.mock("@labshelf/core/dom", () => ({
  ...jest.requireActual("../../../../../core/src/ui/dom/widgets/splitSash"),
  renderElement: jest.requireActual("../../../../../core/src/ui/dom/dom").renderElement,
}));
jest.mock("@labshelf/core", () => ({
  READER_SHELL_BODY: jest.requireActual("../../../../../core/src/reader/protocol/readerPrefs").READER_SHELL_BODY,
  readSourceDeckKind: jest.requireActual("../../../../../core/src/decks/sourceDecks").readSourceDeckKind,
}));

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const BOOT = { channel: "readerPane", type: "boot", boot: { preview: true }, viewerCssUrl: "https://host/pdf_viewer.css" };

function setup(state: unknown = { deckView: "grid" }) {
  document.head.innerHTML = "";
  document.body.innerHTML = `<div id="root"></div>`;
  const root = document.getElementById("root")!;
  const card = document.createElement("div");
  card.className = "ls-card source-editor-card";
  root.append(card);
  const sent: unknown[] = [];
  let saved = state;
  const api = { postMessage: (message: unknown) => { sent.push(message); }, getState: () => saved, setState: (next: unknown) => { saved = next; } };
  const starts: Array<{ pane: HTMLElement; transport: InlineReaderTransport }> = [];
  const pane = mountInlinePreview({
    root, card, api,
    start: async () => async (_boot, element, transport) => { starts.push({ pane: element, transport }); },
    onError: (error) => { throw error; },
  });
  return { root, card, sent, pane, starts, state: () => saved };
}

describe("inline preview pane", () => {
  it("asks the host for the reader's boot when it mounts", () => {
    const { sent } = setup();
    expect(sent).toEqual([{ channel: "readerPane", type: "mount" }]);
  });

  it("builds the split around the card on boot, with the reader's shell, the viewer stylesheet and the remembered width", async () => {
    const { root, card, pane, starts } = setup({ deckView: "grid", [INLINE_PREVIEW_WIDTH_KEY]: "35%" });
    expect(pane.receive(BOOT)).toBe(true);
    const split = root.querySelector<HTMLElement>(".ls-source-split")!;
    expect([...split.children].map((child) => child.className)).toEqual(["ls-card source-editor-card ls-split-code", "ls-split-sash", "ls-split-preview"]);
    expect(card.parentElement).toBe(split);
    expect(split.style.getPropertyValue("--ls-split-code")).toBe("35%");
    expect(split.querySelector(".ls-split-preview #viewerContainer")).not.toBeNull();
    expect(document.head.querySelector<HTMLLinkElement>("link[rel=stylesheet]")?.href).toBe("https://host/pdf_viewer.css");
    await tick();
    expect(starts).toHaveLength(1);
    expect(starts[0]!.pane.className).toBe("ls-split-preview");
  });

  it("shows and hides the pane on setShown, without answering", () => {
    const { root, pane, sent } = setup();
    pane.receive(BOOT);
    const split = root.querySelector<HTMLElement>(".ls-source-split")!;
    expect(split.dataset["preview"]).toBe("hidden");
    expect(pane.receive({ channel: "readerPane", type: "setShown", shown: true })).toBe(true);
    expect(split.dataset["preview"]).toBe("shown");
    pane.receive({ channel: "readerPane", type: "setShown", shown: false });
    expect(split.dataset["preview"]).toBe("hidden");
    expect(sent).toHaveLength(1);
  });

  it("starts one reader however many boots arrive", async () => {
    const { root, pane, starts } = setup();
    pane.receive(BOOT);
    pane.receive(BOOT);
    await tick();
    expect(starts).toHaveLength(1);
    expect(root.querySelectorAll(".ls-source-split")).toHaveLength(1);
    expect(document.head.querySelectorAll("link")).toHaveLength(1);
  });

  it("hands the reader its own messages, keeping the ones that came before it listened, and wraps what it posts", async () => {
    const { pane, starts, sent } = setup();
    pane.receive(BOOT);
    expect(pane.receive({ channel: "reader", message: { type: "init" } })).toBe(true);
    await tick();
    const heard: unknown[] = [];
    starts[0]!.transport.listen((message) => heard.push(message));
    pane.receive({ channel: "reader", message: { type: "buildStatus" } });
    expect(heard).toEqual([{ type: "init" }, { type: "buildStatus" }]);
    starts[0]!.transport.post({ type: "ready" } as never);
    expect(sent.at(-1)).toEqual({ channel: "reader", message: { type: "ready" } });
  });

  it("leaves the editor's messages alone", () => {
    const { pane } = setup();
    expect(pane.receive({ type: "init", path: "main.tex" })).toBe(false);
  });

  it("keeps the dragged width beside the page's other state", () => {
    const { root, pane, state } = setup();
    pane.receive(BOOT);
    const split = root.querySelector<HTMLElement>(".ls-source-split")!;
    const sash = split.querySelector<HTMLElement>(".ls-split-sash")!;
    split.getBoundingClientRect = () => ({ left: 0, width: 1000 } as DOMRect);
    const pointer = (type: string, clientX: number) => { const event = new MouseEvent(type, { button: 0, clientX }); Object.assign(event, { pointerId: 1 }); sash.dispatchEvent(event); };
    pointer("pointerdown", 500);
    pointer("pointermove", 400);
    pointer("pointerup", 400);
    expect(state()).toEqual({ deckView: "grid", [INLINE_PREVIEW_WIDTH_KEY]: "40%" });
  });
});

describe("the editor's channel", () => {
  it("never passes the pane's or the reader's messages to the editor's handlers", () => {
    const handlers: Array<(message: object) => void> = [];
    const inner: MessageEnd<unknown, object> = { post: () => undefined, subscribe: (handler) => { handlers.push(handler); return () => undefined; } };
    const heard: object[] = [];
    withoutInlinePreview(inner).subscribe((message) => heard.push(message));
    for (const message of [{ channel: "reader", message: { type: "init" } }, { channel: "readerPane", type: "boot" }, { type: "init" }]) { handlers[0]!(message); }
    expect(heard).toEqual([{ type: "init" }]);
  });
});
