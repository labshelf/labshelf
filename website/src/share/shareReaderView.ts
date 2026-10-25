// Opens a shared paper's PDF in the core reader, with the sharer's annotations; nothing the visitor does leaves the page.
import {
  DEFAULT_READER_PREFS, PaperDataStore, PROTOCOL_VERSION, READER_SHELL_BODY, ReaderHostController,
  type HostToWebview, type ILogger, type PaperRecord, type ReaderBootParams, type SharedPaper, type SidecarPort,
} from "@labshelf/core";
import { createInPageChannel, PerfMarks, resolveTheme, startReader, showToast } from "@labshelf/core/dom";

import { saveFile } from "./shareDownloads.js";
import { pdfFileName } from "./downloadNames.js";

const asset = (path: string): string => new URL(`./pdfjs/${path}`, import.meta.url).href;

// The visitor's own highlights stay in memory: the share is read-only and the page keeps nothing.
function memorySidecar(paper: SharedPaper): SidecarPort {
  const files = new Map([[paper.metadata.id, JSON.stringify({ annotations: paper.annotations ?? [] })]]);
  return {
    async read(paperId) { return files.get(paperId) ?? null; },
    async write(paperId, text) { files.set(paperId, text); },
  };
}

function bootParams(record: PaperRecord, pdfUrl: string, theme: "light" | "dark"): ReaderBootParams {
  return {
    protocolVersion: PROTOCOL_VERSION,
    assets: {
      pdfjsUrl: asset("build/pdf.min.mjs"),
      viewerUrl: asset("web/pdf_viewer.mjs"),
      workerUrl: asset("build/pdf.worker.min.mjs"),
      pdfUrl,
      cMapUrl: asset("cmaps/"),
      stdFontUrl: asset("standard_fonts/"),
      wasmUrl: asset("wasm/"),
      iccUrl: asset("iccs/"),
    },
    paperId: record.id,
    paperTitle: record.title,
    preview: false,
    themePreference: "auto",
    effectiveTheme: theme,
    prefs: DEFAULT_READER_PREFS,
    isMac: /Mac|iPhone|iPad/.test(navigator.platform),
  };
}

/** Mounts the reader in `container`; one per page, since the reader looks its shell up by id. */
export async function mountShareReader(container: HTMLElement, record: PaperRecord, paper: SharedPaper, bytes: Uint8Array, logger: ILogger): Promise<void> {
  container.innerHTML = READER_SHELL_BODY;
  const theme = resolveTheme("auto");
  const store = new PaperDataStore(memorySidecar(paper), { logger });
  let send: (msg: HostToWebview) => void = () => undefined;
  const host = new ReaderHostController({
    paper: record,
    store,
    post: (msg) => send(msg),
    getPrefs: () => DEFAULT_READER_PREFS,
    autoTheme: () => theme,
    writeClipboard: (text) => navigator.clipboard.writeText(text),
    notify: (message, kind) => { showToast(message, kind); },
    openExternal: async (url) => { window.open(url, "_blank", "noopener"); },
    saveAnnotations: async (markdown) => { saveFile(pdfFileName(record).replace(/\.pdf$/, "-annotations.md"), markdown, "text/markdown"); },
    logger,
  });
  const channel = createInPageChannel((msg) => { void host.handle(msg); });
  send = channel.send;
  const pdfUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  await startReader({
    boot: bootParams(record, pdfUrl, theme),
    transport: channel.transport,
    perf: new PerfMarks(),
    pdf: { createWorker: (url) => new Worker(url, { type: "module" }) },
  });
}
