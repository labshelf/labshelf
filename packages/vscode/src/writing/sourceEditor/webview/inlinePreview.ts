// Shows the project's PDF preview beside an article's source in the LabShelf Editor page, the library's sash between them (as the browser's source tab does);
// the host (provider.ts, readerPane.ts) boots the reader and says whether the pane is shown.
import type { HostToWebview, MessageEnd, ReaderStartupParams, WebviewToHost } from "@labshelf/core";
import { READER_SHELL_BODY } from "@labshelf/core";
import { attachSplitSash, renderElement, SPLIT_WIDTH_PROPERTY } from "@labshelf/core/dom";
import { isReaderEnvelope, isReaderPaneMessage, readerPaneMount, wrapReaderMessage } from "../readerPane.js";

/** The webview state key of the code card's share of the split, kept beside the page's other state. */
export const INLINE_PREVIEW_WIDTH_KEY = "inlinePreviewWidth";

/** The reader's channel as the core reader takes it (ReaderTransport). */
export interface InlineReaderTransport {
  post(message: WebviewToHost): void;
  listen(sink: (message: unknown) => void): void;
}

/** Starts the reader in `pane`, which already holds its shell; loaded lazily, so the editor page does not carry the reader until an article boots it. */
export type StartInlineReader = (boot: ReaderStartupParams, pane: HTMLElement, transport: InlineReaderTransport) => Promise<void>;

export interface InlinePreviewDeps {
  /** The page's root (#root), which holds the editor card. */
  root: HTMLElement;
  /** The editor card, which becomes the split's code side. */
  card: HTMLElement;
  /** The page's single VS Code API object. */
  api: Pick<VsCodeApi, "postMessage" | "getState" | "setState">;
  /** Loads the reader module and starts it. */
  start: () => Promise<StartInlineReader>;
  onError: (error: unknown) => void;
}

export interface InlinePreviewPane {
  /** Takes a host message; true when it was the pane's or the reader's (the editor never sees those). */
  receive(raw: unknown): boolean;
}

/** Whether a message rides the pane's or the reader's channel rather than the editor's. */
function isInlinePreviewMessage(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) { return false; }
  const channel = (raw as { channel?: unknown }).channel;
  return channel === "reader" || channel === "readerPane";
}

/** The editor's channel without the pane's and the reader's messages, which the pane receives on its own. */
export function withoutInlinePreview<Out, In extends object>(transport: MessageEnd<Out, In>): MessageEnd<Out, In> {
  return { post: (message) => transport.post(message), subscribe: (handler) => transport.subscribe((message) => { if (!isInlinePreviewMessage(message)) { handler(message); } }) };
}

function readState(api: InlinePreviewDeps["api"]): Record<string, unknown> {
  const state = api.getState();
  return state && typeof state === "object" ? (state as Record<string, unknown>) : {};
}

/** Links the pdf.js viewer stylesheet the host serves, once. */
function linkViewerCss(url: string): void {
  if (!url || document.head.querySelector(`link[data-ls-viewer-css]`)) { return; }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  link.dataset["lsViewerCss"] = "";
  document.head.append(link);
}

/** Asks the host for the reader's boot and builds the split once it arrives; call after the editor's own ready. */
export function mountInlinePreview(deps: InlinePreviewDeps): InlinePreviewPane {
  const { root, card, api } = deps;
  let split: HTMLElement | undefined;
  let started = false;
  // The host sends setShown after the boot; one that came first is kept for the split.
  let shown = false;
  // Reader messages that arrive before the lazy reader listens wait here.
  const waiting: unknown[] = [];
  let sink: ((message: unknown) => void) | undefined;
  const transport: InlineReaderTransport = {
    post: (message) => api.postMessage(wrapReaderMessage(message)),
    listen: (next) => { sink = next; for (const message of waiting.splice(0)) { next(message); } },
  };

  const build = (): HTMLElement => {
    const host = renderElement("div", { class: "ls-source-split", "data-preview": shown ? "shown" : "hidden" });
    const sash = renderElement("div", { class: "ls-split-sash", role: "separator", "aria-orientation": "vertical", "aria-label": "Resize the preview" });
    const pane = renderElement("div", { class: "ls-split-preview" });
    pane.innerHTML = READER_SHELL_BODY;
    const width = readState(api)[INLINE_PREVIEW_WIDTH_KEY];
    if (typeof width === "string" && width) { host.style.setProperty(SPLIT_WIDTH_PROPERTY, width); }
    card.classList.add("ls-split-code");
    root.append(host);
    host.append(card, sash, pane);
    // The width is remembered for the page, merged into the state the deck and note views keep too.
    attachSplitSash(sash, host, { onEnd: (dragged) => api.setState({ ...readState(api), [INLINE_PREVIEW_WIDTH_KEY]: dragged }) });
    return host;
  };

  const boot = (params: ReaderStartupParams, viewerCssUrl: string): void => {
    // INVARIANT: one reader per document; a second boot (the host mounting again) keeps the reader already started.
    if (started) { return; }
    started = true;
    linkViewerCss(viewerCssUrl);
    split = build();
    const pane = split.querySelector<HTMLElement>(".ls-split-preview")!;
    deps.start().then((start) => start(params, pane, transport)).catch(deps.onError);
  };

  api.postMessage(readerPaneMount());
  return {
    receive(raw) {
      if (isReaderEnvelope(raw)) {
        const message = raw.message as HostToWebview;
        if (sink) { sink(message); } else { waiting.push(message); }
        return true;
      }
      if (isReaderPaneMessage(raw)) {
        if (raw.type === "boot") { boot(raw.boot, raw.viewerCssUrl); }
        else if (raw.type === "setShown") {
          shown = raw.shown;
          if (split) { split.dataset["preview"] = shown ? "shown" : "hidden"; }
        }
        return true;
      }
      return isInlinePreviewMessage(raw);
    },
  };
}
