// Starts the core reader UI on reader/index.html?paper=<id>[&page=<n>] with pdf.js, IndexedDB bytes and an in-page host, or as a build preview.
// The host keeps annotations, reader theme and reading position in the paper's sidecar.
import {
  PROTOCOL_VERSION,
  PaperSidecarStore,
  PaperNotesStore,
  ReaderThemeStore,
  createPreviewStore,
  ReaderHostController,
  answerNoteFileRequest,
  createPaperFiles,
  joinWith,
  type CiteReply,
  type CiteRequest,
  type EffectiveTheme,
  type HostToWebview,
  type ReaderStartupParams,
  type PaperRecord,
  type PreviewPorts,
  type ReaderPrefs,
  type ReaderSidecarStore,
} from "@labshelf/core";
import { PDF_FILE, formatError, type AiProvider } from "@labshelf/core";
import type { PaperObjectsPort } from "@labshelf/core/paperObjects";
import { createLazyPaperObjects } from "../../paperObjects/lazy";
import { createInPageChannel, startReader, PerfMarks, resolveTheme, showToast } from "@labshelf/core/dom";
import { createAiCredentialStore } from "../../platform/settings";
import { bx, createBrowserLogger, createPdfWorker, extensionPdfAssets, pdfjsAssetUrl, downloadTextFile, readThemePref, onThemeChange, type ReaderThemesChangedEvent } from "../../platform";
import { getBrowserCellPorts } from "../../helper";
import { createBrowserEquationPort } from "../../equations/equationPort";
import { createBrowserNoteFileIo, createLibraryFileSystem, createPaperNotesPort, createReaderThemesPort, createSidecarPort, readCachedPaperRecord } from "../../storage";
import { loadReaderPrefs, moveReaderIntoLibrary, onReaderPrefsChange, toggleLibraryDetails, parseReaderQuery } from "./readerTabs";
import { followLiveNotes } from "./liveNotes";
import { readPageLiveFiles } from "../../storage/libraryFileSystem";
import { createReaderCite } from "./citeInProject";
import { installPageGuards, isMacPlatform, sendSidecarChange, attachPreviewPage, findPreviewPaper, createPreviewPorts } from "./readerPreview";

// First statement, so scriptStart measures the whole open like in VS Code.
const perf = new PerfMarks();
const logger = createBrowserLogger();
const fs = createLibraryFileSystem();
const noteFileIo = createBrowserNoteFileIo(fs);
// The equation card's inline form stores a key here and the equation port reads it; the key never crosses the reader protocol.
const aiCredentials = createAiCredentialStore();
const saveAiKey = (provider: AiProvider, key: string): Promise<void> => aiCredentials.set(provider, key);
/**
 * The reader's notes' From paper… port, loaded on first use. It reuses the pdf.js module the reader imported from the same URL,
 * whose worker the reader has set by the time a note can ask, so this page never starts a second pdf.js worker.
 */
function createReaderPaperObjects(): PaperObjectsPort {
  return createLazyPaperObjects(() => import("../../paperObjects/index.js").then(({ createBrowserPaperObjects }) => createBrowserPaperObjects({
    fs, logger, helper: getBrowserCellPorts(logger).helper, openHelperSetup: () => { void bx.runtime.openOptionsPage(); }, credentials: aiCredentials,
    loadPdfjs: () => import(pdfjsAssetUrl("build/pdf.min.mjs")),
  })));
}
const paperObjects = createReaderPaperObjects();

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
  cite?: (request: CiteRequest) => Promise<CiteReply>,
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
    noteFiles: (request) => answerNoteFileRequest(noteFileIo, paper.path, request),
    extractEquation: createBrowserEquationPort({ fs, paper, logger, helper: getBrowserCellPorts(logger).helper, openHelperSetup: () => { void bx.runtime.openOptionsPage(); }, credentials: aiCredentials }),
    sidecarChanged: (change) => sendSidecarChange(paper.id, change),
    paperObjects,
    ...(preview ? { preview } : { themes: new ReaderThemeStore(createReaderThemesPort(fs)) }),
    ...(cite ? { cite } : {}),
  }, page !== undefined ? { page } : {});
  const channel = createInPageChannel((msg) => { void host.handle(msg); });
  send = channel.send;
  return { host, channel };
}

function bootParams(paper: PaperRecord, prefs: ReaderPrefs, preview: boolean): ReaderStartupParams {
  return {
    protocolVersion: PROTOCOL_VERSION,
    assets: {
      ...extensionPdfAssets(),
      viewerUrl: pdfjsAssetUrl("web/pdf_viewer.mjs"),
      // Unused: the bytes come from IndexedDB or the preview's parent page through the readBytes hook.
      pdfUrl: "",
    },
    paperId: paper.id,
    paperTitle: paper.title,
    citeKey: paper.citeKey,
    preview,
    themePreference: "auto",
    effectiveTheme: autoTheme(),
    prefs,
    isMac: isMacPlatform(),
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

/** Holds the paper's notes.qmd live while the page is open, so notes edited in another tab reach this reader; nothing changes without live files. */
async function holdLiveNotes(paper: PaperRecord, host: ReaderHostController): Promise<void> {
  const live = await Promise.resolve().then(readPageLiveFiles).catch((error: unknown) => { void logger.error("reader", error, { action: "readLiveFiles" }); return undefined; });
  if (!live) return;
  const followed = followLiveNotes({ live, path: createPaperFiles(paper.path, joinWith("/")).notes, onChange: () => { void host.refreshNotes().catch(() => undefined); } });
  window.addEventListener("pagehide", () => { void followed.release().catch(() => undefined); }, { once: true });
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
    pdf: { readBytes, createWorker: createPdfWorker },
    saveAiKey,
  });
}

async function main(): Promise<void> {
  installPageGuards();
  const preview = findPreviewPaper(location.search);
  if (preview) { await openPreview(preview); return; }
  const { paperId, page } = parseReaderQuery(location.search);
  if (!paperId) { showFatal("No paper was given to open. Open a paper from the LabShelf library."); return; }
  // Papers are read in the library's workspace; only the workspace's frame runs the reader here.
  if (window.top === window) {
    if (await moveReaderIntoLibrary(paperId, page) === "moved") showFatal("This paper is open in the LabShelf library tab.");
    return;
  }

  const opened = await loadOpenablePaper(paperId);
  if (!opened) return;
  const { paper, prefs } = opened;

  let currentPrefs = prefs;
  const { host, channel } = createHostWithChannel(paper, page, () => currentPrefs, new PaperSidecarStore(createSidecarPort(fs)), undefined, createReaderCite(fs, logger, paper));
  const boot = bootParams(paper, prefs, false);

  forwardChangesToHost(host, (next) => { currentPrefs = next; });
  void holdLiveNotes(paper, host);

  void logger.log("INFO", "reader", "reader opened", { paperId: paper.id, page: page ?? null });
  await startReader({
    boot,
    transport: channel.transport,
    perf,
    pdf: { readBytes: () => readPdfBytes(paper), createWorker: createPdfWorker },
    saveAiKey,
  });
}

main().catch((err: unknown) => {
  void logger.error("reader", err, { op: "open" });
  // startReader already shows its own load errors; anything earlier (storage) lands here.
  const error = document.getElementById("error-msg");
  if (error?.hidden) showFatal(`Failed to open the paper: ${formatError(err)}`);
});
