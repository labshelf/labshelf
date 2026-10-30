// Starts the core reader UI on reader/index.html?paper=<id>[&page=<n>] with pdf.js, IndexedDB bytes and an in-page host, or as a build preview.
// The host keeps annotations, reader theme and reading position in the paper's sidecar.
import {
  PROTOCOL_VERSION,
  PaperSidecarStore,
  PaperNotesStore,
  ReaderThemeStore,
  createPreviewStore,
  ReaderHostController,
  type EffectiveTheme,
  type HostToWebview,
  type ReaderStartupParams,
  type PaperRecord,
  type PreviewPorts,
  type ReaderPrefs,
  type ReaderSidecarStore,
} from "@labshelf/core";
import { PDF_FILE, formatError } from "@labshelf/core";
import { createInPageChannel, startReader, PerfMarks, resolveTheme, showToast } from "@labshelf/core/dom";
import { bx, createBrowserLogger, downloadTextFile, readThemePref, onThemeChange, type ReaderThemesChangedEvent } from "../../platform";
import { getBrowserCellPorts } from "../../helper";
import { createLibraryFileSystem, createPaperNotesPort, createReaderThemesPort, createSidecarPort, readCachedPaperRecord } from "../../storage";
import { loadReaderPrefs, onReaderPrefsChange, toggleLibraryDetails, parseReaderQuery } from "./readerTabs";
import { createReaderSendToNote, type SendToNoteRequest } from "./sendToNote";
import { installPageGuards, isMacPlatform, sendSidecarChange, attachPreviewPage, findPreviewPaper, createPreviewPorts } from "./readerPreview";

// First statement, so scriptStart measures the whole open like in VS Code.
const perf = new PerfMarks();
const logger = createBrowserLogger();
const fs = createLibraryFileSystem();
const PDFJS = "vendor/pdfjs/";

function asset(path: string): string {
  return bx.runtime.getURL(`${PDFJS}${path}`);
}

// PLATFORM: MV3 pages may not start blob: workers (Firefox refuses them); the extension's own module URL works everywhere.
const createWorker = (url: string): Worker => new Worker(url, { type: "module" });

function showFatal(message: string): void {
  const loading = document.getElementById("loading-msg");
  const error = document.getElementById("error-msg");
  if (loading) loading.hidden = true;
  if (error) { error.hidden = false; error.textContent = message; }
}

function autoTheme(): EffectiveTheme {
  return resolveTheme(readThemePref());
}

async function writeClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

async function openExternal(url: string): Promise<void> {
  const current = await bx.tabs.getCurrent().catch(() => undefined);
  await bx.tabs.create({
    url,
    active: true,
    ...(current?.index !== undefined ? { index: current.index + 1 } : {}),
    ...(current?.id !== undefined ? { openerTabId: current.id } : {}),
  });
}

async function readPdfBytes(paper: PaperRecord): Promise<ArrayBuffer> {
  const bytes = await fs.readFile(`${paper.path}/${PDF_FILE}`);
  // pdf.js transfers the buffer to its worker; hand it a private copy of exactly the file's bytes.
  return bytes.slice().buffer;
}

// Resolves the paper and prefs to open, showing the fatal message for each way the open can fail.
async function loadOpenablePaper(paperId: string): Promise<{ paper: PaperRecord; prefs: ReaderPrefs } | undefined> {
  const [paper, prefs] = await Promise.all([readCachedPaperRecord(paperId), loadReaderPrefs()]);
  if (!paper) {
    showFatal("This paper is no longer in your LabShelf library. It may have been removed from this device.");
    void logger.log("WARN", "reader", "reader opened for an unknown paper", { paperId });
    return undefined;
  }
  document.title = paper.title;
  if (!(await fs.stat(`${paper.path}/${PDF_FILE}`))?.isFile) {
    showFatal("This paper has no PDF yet — it was saved from a page that did not offer one.");
    return undefined;
  }
  return { paper, prefs };
}

function createHostWithChannel(
  paper: PaperRecord,
  page: number | undefined,
  getPrefs: () => ReaderPrefs,
  store: ReaderSidecarStore,
  preview?: PreviewPorts,
  sendToNote?: (request: SendToNoteRequest) => Promise<void>,
): { host: ReaderHostController; channel: ReturnType<typeof createInPageChannel> } {
  // The host answers through the channel, which needs the host to exist first.
  let send: (msg: HostToWebview) => void = () => undefined;
  const host = new ReaderHostController({
    paper,
    toggleDetails: toggleLibraryDetails,
    store,
    post: (msg) => send(msg),
    getPrefs,
    autoTheme,
    writeClipboard,
    notify: (message, kind) => { showToast(message, kind); },
    openExternal,
    saveAnnotations: (markdown) => downloadTextFile(`${paper.citeKey}-annotations.md`, markdown, "text/markdown"),
    logger,
    notes: new PaperNotesStore(createPaperNotesPort(fs), { logger }),
    runCell: getBrowserCellPorts(logger).runCell,
    restartCell: getBrowserCellPorts(logger).restartCell,
    installPython: getBrowserCellPorts(logger).installPython,
    sidecarChanged: (change) => sendSidecarChange(paper.id, change),
    ...(preview ? { preview } : { themes: new ReaderThemeStore(createReaderThemesPort(fs)) }),
    ...(sendToNote ? { sendToNote } : {}),
  }, page !== undefined ? { page } : {});
  const channel = createInPageChannel((msg) => { void host.handle(msg); });
  send = channel.send;
  return { host, channel };
}

function bootParams(paper: PaperRecord, prefs: ReaderPrefs, preview: boolean): ReaderStartupParams {
  return {
    protocolVersion: PROTOCOL_VERSION,
    assets: {
      pdfjsUrl: asset("build/pdf.min.mjs"),
      viewerUrl: asset("web/pdf_viewer.mjs"),
      workerUrl: asset("build/pdf.worker.min.mjs"),
      // Unused: the bytes come from IndexedDB or the preview's parent page through the readBytes hook.
      pdfUrl: "",
      cMapUrl: asset("cmaps/"),
      stdFontUrl: asset("standard_fonts/"),
      wasmUrl: asset("wasm/"),
      iccUrl: asset("iccs/"),
    },
    paperId: paper.id,
    paperTitle: paper.title,
    preview,
    themePreference: "auto",
    effectiveTheme: autoTheme(),
    prefs,
    isMac: isMacPlatform(),
  };
}

function exposeReaderApi(paper: PaperRecord, host: ReaderHostController): void {
  window.labshelfReader = {
    paperId: paper.id,
    async reveal(target?: number) {
      const tab = await bx.tabs.getCurrent();
      if (tab?.id !== undefined) await bx.tabs.update(tab.id, { active: true });
      if (tab?.windowId !== undefined) await bx.windows.update(tab.windowId, { focused: true });
      if (target) host.requestPage(target);
    },
  };
}

function forwardChangesToHost(host: ReaderHostController, setPrefs: (prefs: ReaderPrefs) => void): void {
  onThemeChange((theme) => host.onAutoThemeChange(theme));
  onReaderPrefsChange((next) => { setPrefs(next); host.onPrefsChange(); });
  bx.runtime.onMessage.addListener((message: unknown) => {
    const event = message as Partial<ReaderThemesChangedEvent> | null;
    if (event?.type === "reader.themesChanged" && Array.isArray(event.themes)) { host.onCustomThemesChange(event.themes); }
  });
  // Annotations may have changed while this tab was in the background.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void host.refreshAnnotations().catch(() => undefined);
  });
}

async function openPreview(paper: PaperRecord): Promise<void> {
  // INVARIANT: the parent page posts once this page loads, so the listener is bound before the first await; the host asks for prefs only after they load.
  let currentPrefs: ReaderPrefs | undefined;
  const { host, channel } = createHostWithChannel(paper, undefined, () => currentPrefs!, createPreviewStore(), createPreviewPorts(logger));
  const readBytes = attachPreviewPage(host);
  currentPrefs = await loadReaderPrefs();
  forwardChangesToHost(host, (next) => { currentPrefs = next; });
  void logger.log("INFO", "reader", "preview reader opened", { paperId: paper.id });
  await startReader({
    boot: bootParams(paper, currentPrefs, true),
    transport: channel.transport,
    perf,
    pdf: { readBytes, createWorker },
  });
}

async function main(): Promise<void> {
  installPageGuards();
  const preview = findPreviewPaper(location.search);
  if (preview) { await openPreview(preview); return; }
  const { paperId, page } = parseReaderQuery(location.search);
  if (!paperId) { showFatal("No paper was given to open. Open a paper from the LabShelf library."); return; }

  const opened = await loadOpenablePaper(paperId);
  if (!opened) return;
  const { paper, prefs } = opened;

  let currentPrefs = prefs;
  // Offered only when the library has a project to send to.
  const sendToNote = await createReaderSendToNote(fs, logger).catch((err: unknown) => {
    void logger.error("reader", err, { op: "sendToNote" });
    return undefined;
  });
  const { host, channel } = createHostWithChannel(paper, page, () => currentPrefs, new PaperSidecarStore(createSidecarPort(fs)), undefined, sendToNote);
  const boot = bootParams(paper, prefs, false);

  exposeReaderApi(paper, host);
  forwardChangesToHost(host, (next) => { currentPrefs = next; });

  void logger.log("INFO", "reader", "reader opened", { paperId: paper.id, page: page ?? null });
  await startReader({
    boot,
    transport: channel.transport,
    perf,
    pdf: { readBytes: () => readPdfBytes(paper), createWorker },
  });
}

main().catch((err: unknown) => {
  void logger.error("reader", err, { op: "open" });
  // startReader already shows its own load errors; anything earlier (storage) lands here.
  const error = document.getElementById("error-msg");
  if (error?.hidden) showFatal(`Failed to open the paper: ${formatError(err)}`);
});
