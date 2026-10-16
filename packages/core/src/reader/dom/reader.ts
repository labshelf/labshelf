/**
 * Starts the reader: boots pdf.js, builds the chrome around it and connects it to a host. The VS Code webview and the
 * browser extension page both call startReader with their own boot parameters and transport.
 */
import type { ReaderBootParams } from "../index.js";
import { installPolyfills } from "./polyfills.js";
import { ThemeController } from "./chrome/index.js";
import {
  type ReaderContext,
  installTextLayerFocusGuard,
  HostBridge,
  type ReaderTransport,
  describeLoadError,
  DocumentReloader,
  loadPdf,
  type PdfSourceHooks,
  type PerfMarks,
  createViewer,
} from "./session/index.js";
import { interceptCitationClicks, PreviewCitations } from "./hover/index.js";
import { ChangeMarks, Keyboard, SourceSync } from "./navigation/index.js";
import {
  DeferredHover,
  PositionRestore,
  bindHostMessages,
  buildReaderUi,
  createActionRunner,
  interceptExternalLinks,
  reportFirstRender,
} from "./startup/index.js";
import { $ } from "../../ui/dom/index.js";

export interface ReaderStartOptions {
  boot: ReaderBootParams;
  transport: ReaderTransport;
  /** Created by the entry's first statement so `scriptStart` still measures the whole open. */
  perf: PerfMarks;
  /** How the paper's bytes and the pdf.js worker are obtained; VS Code uses the defaults. */
  pdf?: PdfSourceHooks;
}

/**
 * Builds the reader around the shell already in the document (READER_SHELL_BODY) and connects it to a host. Call once per document.
 * @returns resolves once the viewer is wired; on a load failure shows #error-msg and rejects so the host can log it.
 */
export function startReader({ boot, transport, perf, pdf }: ReaderStartOptions): Promise<void> {
  installPolyfills();
  installTextLayerFocusGuard();

  const host = new HostBridge(transport);
  const container = $<HTMLDivElement>("viewerContainer");
  const loadingMsg = $("loading-msg");
  const errorMsg = $("error-msg");
  const restore = new PositionRestore(host);
  const theme = new ThemeController(container, boot.themePreference, boot.effectiveTheme);
  host.on("applyTheme", (msg) => theme.apply(msg.theme, msg.effectiveTheme));

  async function start(): Promise<void> {
    const loaded = await loadPdf(boot.assets, perf, pdf);
    const parts = createViewer(loaded.viewerLib, loaded.pdfDocument, container, $<HTMLDivElement>("viewer"), theme.effective);
    const ctx: ReaderContext = { boot, host, container, prefs: boot.prefs, ...loaded, ...parts };
    theme.attach(ctx.pdfViewer);
    wireReader(ctx, theme, perf, restore, loadingMsg, new DocumentReloader(ctx, pdf ?? {}));
  }

  return start().catch((err: unknown) => {
    loadingMsg.hidden = true;
    errorMsg.hidden = false;
    errorMsg.textContent = describeLoadError(err);
    throw err;
  });
}

/** Connects the open document to its UI, keyboard and host traffic. */
function wireReader(
  ctx: ReaderContext,
  theme: ThemeController,
  perf: PerfMarks,
  restore: PositionRestore,
  loadingMsg: HTMLElement,
  reloader: DocumentReloader,
): void {
  const ui = buildReaderUi(ctx, theme);
  ui.previewChrome?.setDark(theme.effective === "dark");
  theme.onEffectiveChange((effective) => ui.previewChrome?.setDark(effective === "dark"));
  const citations = new PreviewCitations(ctx);
  const hover = new DeferredHover(ctx, theme, citations);
  const keyboard = new Keyboard(ctx, createActionRunner({ ctx, ui, hover }));
  bindHostMessages({ ctx, ui, keyboard, hover, reloader, sourceSync: new SourceSync(ctx), changeMarks: new ChangeMarks(ctx), citations });
  interceptExternalLinks($("viewer"), ctx.host);
  interceptCitationClicks($("viewer"), ctx, citations);
  restore.attach({ ctx, ui, theme, perf, loadingMsg });
  reportFirstRender(ctx, theme, perf, hover);
}
