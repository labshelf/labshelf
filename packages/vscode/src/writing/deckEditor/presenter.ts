// Present and Poster Preview: the audience and presenter panels with the host relay of presenter messages between them, and the one poster preview panel backed by a calibration store.
import * as vscode from "vscode";

import { formatError, parseDeck, readSourceDeckFrames, readSourceDeckNotes, type SourceDeckFormat } from "@labshelf/core";
import { resolvePdfjsUris } from "../../reader/index.js";
import { webviewChunksDir } from "../../ui/index.js";
import type { DeckCommandDeps } from "./commands.js";
import { parsePanelPageMessage, type CalibrationStore, type DeckHostMessage, type DeckMode, type PanelPageMessage } from "./deckMessages.js";
import { readThemeText } from "./deckSync.js";
import { bundleDirectory, deckPanelHtml } from "./provider.js";

const MODULE = "writing/deckEditor";
const MOVE_TO_NEW_WINDOW = "workbench.action.moveEditorToNewWindow";

type PanelMode = Exclude<DeckMode, "edit">;

/** The text of the deck file: an open document's (with unsaved edits) or the disk's; undefined when it cannot be read. */
export async function readDeckText(uri: vscode.Uri): Promise<string | undefined> {
  const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
  if (open) return open.getText();
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

/** The kind a deck file declares, else the one its folder (talks/ or posters/) implies. */
export async function readDeckKind(uri: vscode.Uri): Promise<"talk" | "poster" | null> {
  const text = await readDeckText(uri);
  const declared = text === undefined ? undefined : parseDeck(text).model?.kind;
  if (declared) return declared;
  return uri.path.includes("/posters/") ? "poster" : uri.path.includes("/talks/") ? "talk" : null;
}

const isPresenterWire = (value: unknown): boolean => typeof value === "object" && value !== null && (value as { type?: unknown }).type === "presenter";

/** Forwards every message of type "presenter" from one webview to the other unchanged, both ways, and drops everything else. */
export function relayPresenter(a: vscode.Webview, b: vscode.Webview): vscode.Disposable {
  const forward = (to: vscode.Webview) => (raw: unknown): void => { if (isPresenterWire(raw)) void to.postMessage(raw); };
  const subscriptions = [a.onDidReceiveMessage(forward(b)), b.onDidReceiveMessage(forward(a))];
  return new vscode.Disposable(() => { while (subscriptions.length) subscriptions.pop()?.dispose(); });
}

/** A source talk or poster shown from its built PDF: the PDF file, the source's format and text (for the notes). */
export interface PdfPanelSource { pdf: vscode.Uri; format: SourceDeckFormat; text: string }

interface PanelRequest { deckUri: vscode.Uri; mode: PanelMode; title: string; deps: DeckCommandDeps; pdf?: PdfPanelSource }

/** A webview panel on the deck bundle that answers the page's ready message with an init for its mode, and every other page message through `handle`. */
async function openDeckPanel(request: PanelRequest, handle: (message: PanelPageMessage, post: (message: DeckHostMessage) => void) => Promise<void>): Promise<vscode.WebviewPanel> {
  const { deckUri, mode, title, deps, pdf } = request;
  const folder = vscode.Uri.joinPath(deckUri, "..");
  const themeUri = vscode.Uri.joinPath(folder, "theme.css");
  const pdfjs = pdf ? deps.locatePdfjs?.() ?? null : null;
  const panel = vscode.window.createWebviewPanel("labshelf.deckPanel", title, vscode.ViewColumn.Beside, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [bundleDirectory(deps.extensionUri), webviewChunksDir(deps.extensionUri), folder, ...(pdf ? [vscode.Uri.joinPath(pdf.pdf, "..")] : []), ...(pdfjs ? [pdfjs.root, vscode.Uri.joinPath(pdfjs.pdfjs, "..")] : [])],
  });
  const post = (message: DeckHostMessage): void => { void panel.webview.postMessage(message); };
  const sendInit = async (): Promise<void> => {
    if (pdf) {
      const urls = resolvePdfjsUris(panel.webview, pdfjs);
      if (!urls) throw new Error("PDF.js is not installed, so the PDF cannot be shown.");
      const assets = { pdfjsUrl: urls.pdfjsWebviewUri.toString(), workerUrl: urls.workerWebviewUri.toString(), cMapUrl: urls.cMapWebviewUrl, stdFontUrl: urls.standardFontWebviewUrl, wasmUrl: urls.wasmWebviewUrl, iccUrl: urls.iccWebviewUrl };
      // The version in the query makes a rebuilt PDF bypass the webview cache.
      const pdfUrl = `${panel.webview.asWebviewUri(pdf.pdf).toString()}?v=${Date.now()}`;
      post({ type: "init", mode, deck: "", theme: "", version: 0, assetBase: "", kind: mode === "poster" ? "poster" : "talk", pdf: { url: pdfUrl, assets, notes: readSourceDeckNotes(pdf.format, pdf.text), frames: readSourceDeckFrames(pdf.format, pdf.text) } });
      return;
    }
    const deck = (await readDeckText(deckUri)) ?? "";
    const theme = await readThemeText(themeUri);
    post({ type: "init", mode, deck, theme, version: 0, assetBase: `${panel.webview.asWebviewUri(folder).toString()}/`, kind: parseDeck(deck).model?.kind ?? null });
  };
  const subscription = panel.webview.onDidReceiveMessage((raw: unknown) => {
    const message = parsePanelPageMessage(raw);
    if (!message) return;
    const run = message.type === "ready" ? sendInit() : handle(message, post);
    void run.catch((error: unknown) => {
      void deps.logger.error(MODULE, error, { action: message.type, mode });
      post({ type: "error", message: formatError(error) });
    });
  });
  panel.onDidDispose(() => subscription.dispose());
  panel.webview.html = await deckPanelHtml(panel.webview, deps.extensionUri, title);
  return panel;
}

/** A deck's folder name (deck.html, main.tex or main.typ in talks/<name>/), else the file name of a project's own main file. */
const deckLabel = (deckUri: vscode.Uri): string => {
  const parts = deckUri.path.split("/");
  return /^(talks|posters)$/.test(parts.at(-3) ?? "") ? parts.at(-2) ?? "deck" : parts.at(-1) ?? "deck";
};

/** Opens the presenter panel and the audience panel of a talk, relays presenter messages between them through the host, then moves the audience panel to a new window; closing either closes both. */
export async function openPresenterPanels(deckUri: vscode.Uri, deps: DeckCommandDeps, pdf?: PdfPanelSource): Promise<{ audience: vscode.WebviewPanel; presenter: vscode.WebviewPanel }> {
  const label = deckLabel(deckUri);
  const ignore = async (): Promise<void> => {};
  const presenter = await openDeckPanel({ deckUri, mode: "presenter", title: `Presenter: ${label}`, deps, ...(pdf ? { pdf } : {}) }, ignore);
  const audience = await openDeckPanel({ deckUri, mode: "audience", title: `Audience: ${label}`, deps, ...(pdf ? { pdf } : {}) }, ignore);
  const relay = relayPresenter(audience.webview, presenter.webview);
  let closing = false;
  const closeBoth = (): void => {
    if (closing) return;
    closing = true;
    relay.dispose();
    audience.dispose();
    presenter.dispose();
  };
  audience.onDidDispose(closeBoth);
  presenter.onDidDispose(closeBoth);
  // The audience panel was created last, so it is the active editor the command moves.
  try {
    await vscode.commands.executeCommand(MOVE_TO_NEW_WINDOW);
  } catch (error) {
    void deps.logger.log("WARN", MODULE, "The audience panel could not be moved to a new window.", { error: formatError(error) });
  }
  return { audience, presenter };
}

/** Opens the Poster Preview panel of a poster; the page loads and saves its calibration through the store, answered by request id. */
export function openPosterPreviewPanel(deckUri: vscode.Uri, deps: DeckCommandDeps, store: CalibrationStore, pdf?: PdfPanelSource): Promise<vscode.WebviewPanel> {
  return openDeckPanel({ deckUri, mode: "poster", title: `Poster Preview: ${deckLabel(deckUri)}`, deps, ...(pdf ? { pdf } : {}) }, async (message, post) => {
    if (message.type !== "calibration") return;
    if (message.action === "load") {
      const calibration = await store.load();
      post(calibration ? { type: "calibration", id: message.id, calibration } : { type: "calibration", id: message.id });
      return;
    }
    await store.save(message.calibration);
    post({ type: "calibration", id: message.id, calibration: message.calibration });
  });
}
