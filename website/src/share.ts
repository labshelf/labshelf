// Opens the share link in the page's fragment and shows its folder in the library UI, or one of its papers in the reader.
import {
  createLoopbackTransport, createWorkerShareReader, DEFAULT_PREFS, errorMessage, openShare, type OpenedShare,
} from "@labshelf/core";
import { applyThemeToDocument, mountLibraryUi, resolveTheme, toast, type MenuEntry } from "@labshelf/core/dom";

import { consoleLogger } from "./demos/log/index.js";
import {
  attachShareHost, createShareLibrary, downloadPdf, downloadZip, installShareStyles, LOADING_STATE, mountShareReader,
  openErrorState, PDF_ERROR_TEXT, PdfLoadError, renderState, renderTopBar, saveFile, type ShareLibrary,
} from "./share/index.js";

const MODULE = "share-page";

interface Page { bar: HTMLElement; main: HTMLElement }

// TRAP: the query names the paper on show; the link stays in the fragment, which the browser never sends.
const paperParam = (): string | null => new URLSearchParams(location.search).get("paper");
const openPaper = (id: string): void => { location.assign(`?paper=${encodeURIComponent(id)}${location.hash}`); };
const backToFolder = (): void => { location.assign(`${location.pathname}${location.hash}`); };

function failure(err: unknown): string {
  return err instanceof PdfLoadError ? PDF_ERROR_TEXT[err.reason] : errorMessage(err);
}

async function run(what: string, task: () => Promise<void>, context: Record<string, unknown>): Promise<void> {
  try {
    await task();
  } catch (err) {
    toast(failure(err), "error");
    void consoleLogger.error(MODULE, err, { what, ...context });
  }
}

function downloadMenu(share: OpenedShare, library: ShareLibrary, current: () => string | null): MenuEntry[] {
  const paper = current() === null ? undefined : library.paper(current()!);
  const papers = library.snapshot.papers.map((p) => library.paper(p.id)!);
  return [
    { icon: "file", label: "This paper's PDF", disabled: !paper?.pdf, onSelect: () => {
      void run("download pdf", () => downloadPdf(share, paper!), { paperId: paper!.metadata.id });
    } },
    { icon: "download", label: "All papers as .zip", onSelect: () => {
      const dismiss = toast("Preparing the .zip…");
      void run("download zip", async () => {
        const failed = await downloadZip(share, share.manifest.folder, papers);
        if (failed.length > 0) {
          toast(`${failed.length} PDF${failed.length === 1 ? " was" : "s were"} left out: they could not be read.`, "error");
          void consoleLogger.log("WARN", MODULE, "Left PDFs out of the .zip", { failed: failed.map((f) => f.message) });
        }
      }, { papers: papers.length }).finally(dismiss);
    } },
  ];
}

function showLibrary(page: Page, share: OpenedShare, library: ShareLibrary): void {
  let selected: string | null = null;
  renderTopBar(page.bar, { folder: share.manifest.folder, link: share.link, downloads: () => downloadMenu(share, library, () => selected) });
  page.main.replaceChildren();
  const { ui, host } = createLoopbackTransport();
  // The host listens before the UI mounts, so the UI's ready message finds it.
  attachShareHost(host, {
    library,
    openPaper,
    selected: (id) => { selected = id; },
    saveText: (name, text) => saveFile(name, text, "text/markdown"),
    log: consoleLogger,
  });
  mountLibraryUi(page.main, {
    transport: ui,
    // The page keeps nothing, so the list's preferences reset on reload.
    prefs: { load: () => ({ ...DEFAULT_PREFS }), save: () => undefined },
    capabilities: {},
    readOnly: true,
    labels: { addTooltip: "Open in LabShelf to add papers", emptyHint: "This shared folder holds no papers." },
  });
}

async function showPaper(page: Page, share: OpenedShare, library: ShareLibrary, id: string): Promise<void> {
  const record = library.snapshot.papers.find((p) => p.id === id);
  const paper = record && library.paper(id);
  renderTopBar(page.bar, { folder: share.manifest.folder, link: share.link, back: backToFolder, downloads: () => downloadMenu(share, library, () => id) });
  if (!record || !paper) {
    renderState(page.main, { icon: "warning", text: "This paper is not in the shared folder", back: backToFolder });
    return;
  }
  renderState(page.main, { icon: "loader", text: "Downloading the PDF…" });
  const result = await share.loadPdf(paper);
  if (!result.ok) {
    void consoleLogger.log("WARN", MODULE, "Shared PDF could not be read", { paperId: id, error: result.error, detail: result.detail });
    const state = { icon: "warning" as const, text: PDF_ERROR_TEXT[result.error], back: backToFolder };
    renderState(page.main, result.error === "network" ? { ...state, retry: () => { void showPaper(page, share, library, id); } } : state);
    return;
  }
  await mountShareReader(page.main, record, paper, result.bytes, consoleLogger);
}

async function open(page: Page): Promise<void> {
  renderTopBar(page.bar, {});
  renderState(page.main, LOADING_STATE);
  const opened = await openShare(location.href, (relayUrl) => createWorkerShareReader({ relayUrl }));
  if (!opened.ok) {
    void consoleLogger.log("WARN", MODULE, "Share link could not be opened", { error: opened.error, detail: opened.detail });
    renderState(page.main, openErrorState(opened.error, () => { void open(page); }));
    return;
  }
  const library = createShareLibrary(opened.share.manifest);
  if (library.dropped.length > 0) {
    void consoleLogger.log("WARN", MODULE, "Left out papers with unusable ids", { ids: library.dropped });
  }
  document.title = `${opened.share.manifest.folder} · Shared with LabShelf`;
  const id = paperParam();
  if (id === null) showLibrary(page, opened.share, library);
  else await showPaper(page, opened.share, library, id);
}

const bar = document.getElementById("share-bar");
const main = document.getElementById("share-main");
if (bar && main) {
  // TRAP: pasting another share link over this one only changes the fragment, which reloads nothing by itself.
  window.addEventListener("hashchange", () => { location.reload(); });
  applyThemeToDocument(resolveTheme("auto"));
  installShareStyles(paperParam() === null ? "library" : "reader");
  document.body.dataset["view"] = paperParam() === null ? "library" : "reader";
  open({ bar, main }).catch((err: unknown) => {
    renderState(main, { icon: "warning", text: "Something went wrong opening this folder", hint: errorMessage(err) });
    void consoleLogger.error(MODULE, err);
  });
}
