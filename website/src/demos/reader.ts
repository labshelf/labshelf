// Mounts the shared reader on the demo paper in the page's [data-demo="reader"] container.
import { PROTOCOL_VERSION, DEFAULT_READER_PREFS, READER_SHELL_BODY, type ReaderStartupParams } from "@labshelf/core";
import { PerfMarks, startReader } from "@labshelf/core/dom";
import { DEMO_PAPER, createMemoryHost, fenceReaderKeys, installReaderStyles } from "./reader/index.js";
import { consoleLogger } from "./log/index.js";
import { onSiteThemeChange, siteTheme } from "./siteTheme.js";

const perf = new PerfMarks();
const asset = (path: string): string => new URL(`../pdfjs/${path}`, import.meta.url).href;

function bootParams(): ReaderStartupParams {
  return {
    protocolVersion: PROTOCOL_VERSION,
    assets: {
      pdfjsUrl: asset("build/pdf.min.mjs"),
      viewerUrl: asset("web/pdf_viewer.mjs"),
      workerUrl: asset("build/pdf.worker.min.mjs"),
      pdfUrl: new URL("paper.pdf", import.meta.url).href,
      cMapUrl: asset("cmaps/"),
      stdFontUrl: asset("standard_fonts/"),
      wasmUrl: asset("wasm/"),
      iccUrl: asset("iccs/"),
    },
    paperId: DEMO_PAPER.id,
    paperTitle: DEMO_PAPER.title,
    preview: false,
    themePreference: "auto",
    effectiveTheme: siteTheme(),
    prefs: DEFAULT_READER_PREFS,
    isMac: /Mac|iPhone|iPad/.test(navigator.platform),
  };
}

// The reader's app tokens sit on :root, so the root carries core's data-theme for the menus and popovers.
function followSiteTheme(): void {
  const mark = (): void => { document.documentElement.setAttribute("data-theme", siteTheme()); };
  mark();
  onSiteThemeChange(mark);
}

async function mount(container: HTMLElement): Promise<void> {
  installReaderStyles();
  followSiteTheme();
  container.innerHTML = READER_SHELL_BODY;
  fenceReaderKeys(container);
  const channel = await createMemoryHost();
  await startReader({
    boot: bootParams(),
    transport: channel.transport,
    perf,
    pdf: { createWorker: (url) => new Worker(url, { type: "module" }) },
  });
}

// startReader looks its shell up by id, so one reader per page.
const container = document.querySelector<HTMLElement>('[data-demo="reader"]');
if (container) {
  mount(container).catch((err: unknown) => { void consoleLogger.error("reader-demo", err, { paperId: DEMO_PAPER.id }); });
}
