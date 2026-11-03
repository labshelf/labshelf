// Mounts the core deck editor, a Present view or the Poster Preview over the webview messaging API (entry of dist/deckEditor/deckEditor.js); the extension host answers in writing/deckEditor/provider.ts and presenter.ts.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/code-themes.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "../../webview/index.js";
import "@labshelf/core/styles/deck-editor.css";
import "./deckEditor.css";
import type { DeckEditorController, PresenterChannel, PresenterController, PresenterMessage, PosterPreviewController } from "@labshelf/core/deckEditor";
import { createWebviewTransport } from "../../../webview/index.js";
import type { CalibrationStore, DeckHostMessage, DeckPageMessage, PanelPageMessage, WireCalibration } from "../deckMessages.js";

type Init = Extract<DeckHostMessage, { type: "init" }>;
type Update = Extract<DeckHostMessage, { type: "update" }>;

const transport = createWebviewTransport<DeckPageMessage | PanelPageMessage, DeckHostMessage>(acquireVsCodeApi());
const post = (message: DeckPageMessage | PanelPageMessage): void => transport.post(message);

/** The document version the page's deck stands on; every edit names it as its base. */
let version = 0;
let controller: DeckEditorController | PresenterController | PosterPreviewController | undefined;
/** An update that came while the editor chunk was loading; applied once it mounts. */
let pending: Update | undefined;

function showError(message: string): void {
  const root = document.getElementById("root");
  if (!root) return;
  const status = document.createElement("p");
  status.className = "deck-editor-host-error";
  status.setAttribute("role", "alert");
  status.textContent = message;
  root.append(status);
}

/** A PresenterChannel over the host: each message crosses the wire as { type: "presenter", message }, and received ones are validated. */
function createHostChannel(parse: (value: unknown) => PresenterMessage | null): PresenterChannel {
  const listeners = new Set<(message: PresenterMessage) => void>();
  let closed = false;
  const unsubscribe = transport.subscribe((message) => {
    if (message.type !== "presenter" || closed) return;
    const parsed = parse(message.message);
    if (parsed) for (const listener of [...listeners]) listener(parsed);
  });
  return {
    post: (message) => { if (!closed) post({ type: "presenter", message }); },
    onMessage: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close: () => { closed = true; listeners.clear(); unsubscribe(); },
  };
}

/** The calibration store whose load and save are answered by the host, matched by request id. */
function createHostCalibrationStore(): CalibrationStore {
  let nextId = 0;
  const waiting = new Map<number, (calibration: WireCalibration | undefined) => void>();
  transport.subscribe((message) => {
    if (message.type !== "calibration") return;
    waiting.get(message.id)?.(message.calibration);
    waiting.delete(message.id);
  });
  const request = (build: (id: number) => PanelPageMessage): Promise<WireCalibration | undefined> =>
    new Promise((resolve) => { const id = nextId++; waiting.set(id, resolve); post(build(id)); });
  return {
    load: () => request((id) => ({ type: "calibration", action: "load", id })),
    save: async (calibration) => { await request((id) => ({ type: "calibration", action: "save", id, calibration })); },
  };
}

/** Opens the PDF of a LaTeX or Typst talk or poster in the panel's mode; the notes of each source slide go to the pages that show it. */
async function startPdfPanel(init: Init, pdfInit: NonNullable<Init["pdf"]>, root: HTMLElement): Promise<void> {
  const core = await import("@labshelf/core/deckEditor");
  const pdf = await core.openPdfDeck({ assets: pdfInit.assets, readBytes: async () => (await fetch(pdfInit.url)).arrayBuffer() });
  if (init.mode === "poster") {
    controller = await core.openContentPosterPreview(root, { store: createHostCalibrationStore(), content: core.pdfPosterContent(pdf) });
    return;
  }
  const role = init.mode === "audience" ? "audience" : "presenter";
  const source = core.pdfSlideSource(pdf, pdfInit.notes, core.mapPagesToSlides(pdf.labels, pdf.count, pdfInit.notes.length));
  controller = core.openSlidesPresenter(root, { role, source, channel: createHostChannel(core.parsePresenterMessage) });
}

async function startPanel(init: Init, root: HTMLElement): Promise<void> {
  if (init.pdf) return startPdfPanel(init, init.pdf, root);
  const core = await import("@labshelf/core/deckEditor");
  const resolveAsset = async (path: string): Promise<string> => new URL(path, init.assetBase).href;
  if (init.mode === "poster") {
    controller = await core.openPosterPreview(root, { html: init.deck, theme: init.theme, store: createHostCalibrationStore(), resolveAsset });
    return;
  }
  const role = init.mode === "audience" ? "audience" : "presenter";
  controller = core.openPresenter(root, { role, html: init.deck, theme: init.theme, channel: createHostChannel(core.parsePresenterMessage), resolveAsset });
}

async function start(init: Init): Promise<void> {
  const root = document.getElementById("root");
  if (!root || controller) return;
  version = init.version;
  if (init.mode && init.mode !== "edit") return startPanel(init, root);
  const { openDeckEditor, mountDeckProperties } = await import("@labshelf/core/deckEditor");
  let editor: DeckEditorController | undefined;
  // The properties panel beside the editor: text style, position and shapes, each one editor step.
  const properties = mountDeckProperties(root, () => editor);
  // Undo and redo are VS Code's: with history "host" and no onUndo/onRedo the page keeps no history of its own.
  controller = openDeckEditor(root, {
    html: init.deck,
    theme: init.theme,
    resolveAsset: async (path) => new URL(path, init.assetBase).href,
    history: "host",
    onChange: (change) => post({ type: "edit", deck: change.html, theme: change.theme, baseVersion: version }),
    onRender: (view) => properties.render(view),
  });
  editor = controller;
  if (pending) { applyUpdate(pending); pending = undefined; }
}

function applyUpdate(update: Update): void {
  version = update.version;
  if (controller && "setDocument" in controller) controller.setDocument(update.deck, update.theme);
}

transport.subscribe((message) => {
  if (message.type === "init") {
    void start(message).catch((error: unknown) => showError(`The deck editor could not start: ${error instanceof Error ? error.message : String(error)}`));
  } else if (message.type === "update") {
    if (controller) applyUpdate(message); else pending = message;
  } else if (message.type === "error") {
    showError(message.message);
  }
});

post({ type: "ready" });
