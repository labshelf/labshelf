// Starts the core reader UI on reader/index.html?paper=<id>[&page=<n>] with pdf.js, IndexedDB bytes and an in-page host.
// The host keeps annotations, reader theme and reading position in the paper's synced sidecar.
import {
  PROTOCOL_VERSION,
  PaperDataStore,
  ReaderHostController,
  type EffectiveTheme,
  type HostToWebview,
  type ReaderBootParams,
  type PaperRecord,
  type ReaderPrefs,
} from "@labshelf/core";
import { PDF_FILE } from "@labshelf/core";
import { startReader, PerfMarks, resolveTheme, toast } from "@labshelf/core/dom";
import { BrowserLogger, bx, downloadTextFile } from "../platform";
import { IndexedDbFileSystem, createIdbSidecarPort, getRecord } from "../storage";
import { getThemePref, onThemeChange } from "../ui";
import { createInPageChannel } from "./inPageTransport";
import { loadReaderPrefs, onReaderPrefsChange } from "./access";
import { installPageGuards, isMacPlatform } from "./pageGuards";
import { parseReaderQuery } from "./access";
import { announceSidecarChange } from "./sidecarChangeNotice";

// First statement, so scriptStart measures the whole open like in VS Code.
const perf = new PerfMarks();
const logger = new BrowserLogger("reader");
const fs = new IndexedDbFileSystem();
const PDFJS = "vendor/pdfjs/";

function asset(path: string): string {
  return bx.runtime.getURL(`${PDFJS}${path}`);
}

function showFatal(message: string): void {
  const loading = document.getElementById("loading-msg");
  const error = document.getElementById("error-msg");
  if (loading) loading.hidden = true;
  if (error) { error.hidden = false; error.textContent = message; }
}

function autoTheme(): EffectiveTheme {
  return resolveTheme(getThemePref());
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
  const [paper, prefs] = await Promise.all([getRecord(paperId), loadReaderPrefs()]);
  if (!paper) {
    showFatal("This paper is no longer in your LabShelf library. It may have been removed, or the library has not synced yet.");
    void logger.warn("reader opened for an unknown paper", { paperId });
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
): { host: ReaderHostController; channel: ReturnType<typeof createInPageChannel> } {
  const store = new PaperDataStore(createIdbSidecarPort(fs));
  // The host answers through the channel, which needs the host to exist first.
  let send: (msg: HostToWebview) => void = () => undefined;
  const host = new ReaderHostController({
    paper,
    store,
    post: (msg) => send(msg),
    getPrefs,
    autoTheme,
    writeClipboard,
    notify: (message, kind) => { toast(message, kind); },
    openExternal,
    saveAnnotations: (markdown) => downloadTextFile(`${paper.citeKey}-annotations.md`, markdown, "text/markdown"),
    logger,
    sidecarChanged: (change) => announceSidecarChange(paper.id, change),
  }, page !== undefined ? { page } : {});
  const channel = createInPageChannel((msg) => { void host.handle(msg); });
  send = channel.send;
  return { host, channel };
}

function bootParams(paper: PaperRecord, prefs: ReaderPrefs): ReaderBootParams {
  return {
    protocolVersion: PROTOCOL_VERSION,
    assets: {
      pdfjsUrl: asset("build/pdf.min.mjs"),
      viewerUrl: asset("web/pdf_viewer.mjs"),
      workerUrl: asset("build/pdf.worker.min.mjs"),
      // Unused: the bytes come from IndexedDB through the readBytes hook.
      pdfUrl: "",
      cMapUrl: asset("cmaps/"),
      stdFontUrl: asset("standard_fonts/"),
      wasmUrl: asset("wasm/"),
      iccUrl: asset("iccs/"),
    },
    paperId: paper.id,
    paperTitle: paper.title,
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
  // A sync may have brought annotations made in VS Code while this tab was in the background.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void host.refreshAnnotations().catch(() => undefined);
  });
}

async function main(): Promise<void> {
  installPageGuards();
  const { paperId, page } = parseReaderQuery(location.search);
  if (!paperId) { showFatal("No paper was given to open. Open a paper from the LabShelf library."); return; }

  const opened = await loadOpenablePaper(paperId);
  if (!opened) return;
  const { paper, prefs } = opened;

  let currentPrefs = prefs;
  const { host, channel } = createHostWithChannel(paper, page, () => currentPrefs);
  const boot = bootParams(paper, prefs);

  exposeReaderApi(paper, host);
  forwardChangesToHost(host, (next) => { currentPrefs = next; });

  void logger.info("reader opened", { paperId: paper.id, page: page ?? null });
  await startReader({
    boot,
    transport: channel.transport,
    perf,
    pdf: {
      readBytes: () => readPdfBytes(paper),
      // MV3 pages may not start blob: workers (Firefox refuses them); the extension's own module URL works everywhere.
      createWorker: (url) => new Worker(url, { type: "module" }),
    },
  });
}

main().catch((err: unknown) => {
  void logger.error("reader", err, { op: "open" });
  // startReader already shows its own load errors; anything earlier (storage) lands here.
  const error = document.getElementById("error-msg");
  if (error?.hidden) showFatal(`Failed to open the paper: ${err instanceof Error ? err.message : String(err)}`);
});
