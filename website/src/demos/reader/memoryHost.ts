// Answers the demo reader with the shared host controller over an in-memory sidecar, so nothing leaves the page.
import {
  PaperDataStore, ReaderHostController, DEFAULT_READER_PREFS,
  type HostToWebview, type SidecarPort,
} from "@labshelf/core";
import { createInPageChannel, showToast, type InPageChannel } from "@labshelf/core/dom";
import { consoleLogger } from "../log/index.js";
import { DEMO_PAPER, OPENING_STATE, SEEDED_HIGHLIGHT } from "./demoPaper.js";

function memorySidecar(): SidecarPort {
  const files = new Map<string, string>();
  return {
    async read(paperId) { return files.get(paperId) ?? null; },
    async write(paperId, text) { files.set(paperId, text); },
  };
}

/** @returns the reader-side channel of a host whose sidecar already holds the seeded highlight and opening state. */
export async function createMemoryHost(): Promise<InPageChannel> {
  const store = new PaperDataStore(memorySidecar(), { logger: consoleLogger });
  const { pageNumber, content, color } = SEEDED_HIGHLIGHT;
  await store.addHighlight(DEMO_PAPER.id, pageNumber, content, color);
  await store.setReadingState(DEMO_PAPER.id, { ...OPENING_STATE, updatedAt: new Date().toISOString() });
  // The host answers through the channel, which needs the host to exist first.
  let send: (msg: HostToWebview) => void = () => undefined;
  const host = new ReaderHostController({
    paper: DEMO_PAPER,
    store,
    post: (msg) => send(msg),
    getPrefs: () => DEFAULT_READER_PREFS,
    autoTheme: () => "dark",
    writeClipboard: (text) => navigator.clipboard.writeText(text),
    notify: (message, kind) => { showToast(message, kind); },
    openExternal: async (url) => { window.open(url, "_blank", "noopener"); },
    saveAnnotations: async (markdown) => { await navigator.clipboard.writeText(markdown); showToast("Annotations copied as Markdown.", "ok"); },
    logger: consoleLogger,
  });
  const channel = createInPageChannel((msg) => { void host.handle(msg); });
  send = channel.send;
  return channel;
}
