/**
 * Starts the reader: boots pdf.js, builds the chrome around it and connects it to a host. The VS Code webview and the
 * browser extension page both call startReader with their own boot parameters and transport.
 */
import type { ReaderStartupParams } from "../index.js";
import type { QmdViewStatePort } from "../../qmd/index.js";
import type { AiProvider } from "../../ai/credentials.js";
import { installPolyfills } from "./polyfills.js";
import { ThemeController } from "./theme.js";
import {
  type ReaderContext, installTextLayerFocusGuard, HostBridge, type ReaderTransport, type PerfMarks, createPdfjsReader,
} from "./readerSession.js";
import { describeLoadError, PdfReloader, loadPdf, type PdfSourceHooks } from "./pdfLoader.js";
import { DeferredHover, attachReaderHostMessages, buildReaderUi, mountReaderConsult, type ReaderUi } from "./readerUi.js";
import type { ConsultSetup } from "../../writing/consult/dom/createConsult.js";
import { ReadingPositionRestore, createActionRunner, attachExternalUrls, reportFirstRender } from "./startup.js";
import { attachCitationClicks, PreviewCitations } from "./citations.js";
import { ChangeMarks } from "./findMarks.js";
import { Keyboard, SourceSync } from "./navigation.js";
import { findElement } from "../../ui/dom/index.js";

interface ReaderStartOptions {
  boot: ReaderStartupParams;
  transport: ReaderTransport;
  /** Created by the entry's first statement so `scriptStart` still measures the whole open. */
  perf: PerfMarks;
  /** How the paper's bytes and the pdf.js worker are obtained; VS Code uses the defaults. */
  pdf?: PdfSourceHooks;
  /** Where collapsed cells and sections and the Advanced switch of the open notes are kept; absent keeps nothing. */
  viewState?: QmdViewStatePort;
  /** Stores an AI provider key where the host's equation port reads it; given, the equation card asks for the key inline. Only a host in the same page passes it (the browser). */
  saveAiKey?: (provider: AiProvider, key: string) => Promise<void>;
  /** Resolves the host's consult once the UI is built (never in a build preview); undefined or a rejection leaves the toolbar without Consult. */
  consult?: () => Promise<ConsultSetup | undefined>;
}

/**
 * Builds the reader around the shell already in the document (READER_SHELL_BODY) and connects it to a host. Call once per document.
 * @returns resolves once the viewer is wired; on a load failure shows #error-msg and rejects so the host can log it.
 */
export function startReader({ boot, transport, perf, pdf, viewState, saveAiKey, consult }: ReaderStartOptions): Promise<void> {
  installPolyfills();
  installTextLayerFocusGuard();

  const host = new HostBridge(transport);
  const container = findElement<HTMLDivElement>("viewerContainer");
  const loadingMsg = findElement("loading-msg");
  const errorMsg = findElement("error-msg");
  const restore = new ReadingPositionRestore(host);
  const theme = new ThemeController(container, boot.themePreference, boot.effectiveTheme, boot.preview);
  host.on("applyTheme", (msg) => theme.apply(msg.theme, msg.effectiveTheme, msg.customTheme));
  host.on("customThemes", (msg) => theme.setCustomThemes(msg.themes));

  async function start(): Promise<void> {
    const loaded = await loadPdf(boot.assets, perf, pdf);
    const parts = createPdfjsReader(loaded.viewerLib, loaded.pdfDocument, container, findElement<HTMLDivElement>("viewer"), theme.pageTheme, boot.preview);
    const ctx: ReaderContext = { boot, host, container, prefs: boot.prefs, viewState, saveAiKey, ...loaded, ...parts };
    theme.attach(ctx.pdfViewer);
    const ui = wireReader(ctx, theme, perf, restore, loadingMsg, new PdfReloader(ctx, pdf ?? {}));
    if (consult && !boot.preview) { attachConsult(ui, consult); }
  }

  return start().catch((err: unknown) => {
    loadingMsg.hidden = true;
    errorMsg.hidden = false;
    errorMsg.textContent = describeLoadError(err);
    throw err;
  });
}

/** Asks the host for its consult once and shows it in the toolbar; leaving the page closes its windows, which flushes and releases their files. */
function attachConsult(ui: ReaderUi, resolve: () => Promise<ConsultSetup | undefined>): void {
  void resolve().then((setup) => {
    if (!setup) { return; }
    const mounted = mountReaderConsult(ui.toolbar, setup);
    window.addEventListener("pagehide", () => { void mounted.dispose(); }, { once: true });
  }, (error: unknown) => console.warn("LabShelf reader: the consult is not available", error));
}

/** Connects the open document to its UI, keyboard and host traffic. */
function wireReader(
  ctx: ReaderContext,
  theme: ThemeController,
  perf: PerfMarks,
  restore: ReadingPositionRestore,
  loadingMsg: HTMLElement,
  reloader: PdfReloader,
): ReaderUi {
  const ui = buildReaderUi(ctx, theme);
  const citations = new PreviewCitations(ctx);
  const hover = new DeferredHover(ctx, theme, citations);
  const keyboard = new Keyboard(ctx, createActionRunner({ ctx, ui, hover }));
  attachReaderHostMessages({ ctx, ui, keyboard, hover, reloader, sourceSync: new SourceSync(ctx), changeMarks: new ChangeMarks(ctx), citations });
  attachExternalUrls(findElement("viewer"), ctx.host);
  attachCitationClicks(findElement("viewer"), ctx, citations);
  restore.attach({ ctx, ui, theme, perf, loadingMsg });
  reportFirstRender(ctx, theme, perf, hover);
  return ui;
}
