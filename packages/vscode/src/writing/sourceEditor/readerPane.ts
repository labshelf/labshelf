// The messages between the LabShelf editor page and its host for the project's PDF preview shown inside an article's tab.
// Shared by the extension host (provider.ts) and the webview page, so it imports nothing from `vscode`.
import { readSourceDeckKind, type HostToWebview, type ReaderStartupParams, type WebviewToHost } from "@labshelf/core";

/** The reader's own traffic, both ways, wrapped so it does not mix with the editor's messages. */
export interface ReaderEnvelope<M extends WebviewToHost | HostToWebview = WebviewToHost | HostToWebview> {
  channel: "reader";
  message: M;
}

/** Page to host: the pane exists and asks for its boot; sent on every page start, so a reloaded page gets a fresh reader. */
export interface ReaderPaneMount { channel: "readerPane"; type: "mount" }
/** Page to host: the user showed or hid the pane (its eye), or the page restored the state it keeps. */
export interface ReaderPaneShown { channel: "readerPane"; type: "shown"; shown: boolean }
/** Host to page: what the reader needs to start, and the pdf.js viewer stylesheet the page links. */
export interface ReaderPaneBoot { channel: "readerPane"; type: "boot"; boot: ReaderStartupParams; viewerCssUrl: string }
/** Host to page: show or hide the pane, shared by every article tab. */
export interface ReaderPaneSetShown { channel: "readerPane"; type: "setShown"; shown: boolean }

type ReaderPaneOutbound = ReaderPaneMount | ReaderPaneShown;
type ReaderPaneInbound = ReaderPaneBoot | ReaderPaneSetShown;
export type ReaderPaneMessage = ReaderPaneOutbound | ReaderPaneInbound;

const isRecord = (raw: unknown): raw is Record<string, unknown> => typeof raw === "object" && raw !== null;

/** Whether a message carries reader traffic; the reader's own guards check the message inside. */
export function isReaderEnvelope(raw: unknown): raw is ReaderEnvelope {
  return isRecord(raw) && raw["channel"] === "reader" && isRecord(raw["message"]);
}

/** Whether a message is a well-formed pane control message, in either direction. */
export function isReaderPaneMessage(raw: unknown): raw is ReaderPaneMessage {
  if (!isRecord(raw) || raw["channel"] !== "readerPane") { return false; }
  switch (raw["type"]) {
    case "mount": return true;
    case "shown":
    case "setShown": return typeof raw["shown"] === "boolean";
    case "boot": return isRecord(raw["boot"]) && typeof raw["viewerCssUrl"] === "string";
    default: return false;
  }
}

export const wrapReaderMessage = <M extends WebviewToHost | HostToWebview>(message: M): ReaderEnvelope<M> => ({ channel: "reader", message });
export const readerPaneMount = (): ReaderPaneMount => ({ channel: "readerPane", type: "mount" });
export const readerPaneShown = (shown: boolean): ReaderPaneShown => ({ channel: "readerPane", type: "shown", shown });
export const readerPaneBoot = (boot: ReaderStartupParams, viewerCssUrl: string): ReaderPaneBoot => ({ channel: "readerPane", type: "boot", boot, viewerCssUrl });
export const readerPaneSetShown = (shown: boolean): ReaderPaneSetShown => ({ channel: "readerPane", type: "setShown", shown });

/** A LaTeX or Typst source that is not a talk or poster: the files whose tab carries the project's PDF beside them (the browser's source tab uses the same rule). */
export function isArticleSource(path: string, text: string): boolean {
  return /\.(tex|typ)$/i.test(path) && readSourceDeckKind(path, text) === undefined;
}
