/**
 * Answers the reader's messages on the host side: validates each one and replies through the host's ports.
 */
import type { Annotation, PdfTheme } from "../model/index.js";
import { formatError } from "../errors/index.js";
import {
  type BuildState, type PageArea, type PagePoint, type PreviewBuildRoots, isWebviewMessage, type EffectiveTheme,
  type HostToWebview, type WebviewToHost,
} from "./protocol/index.js";
import { annotationHandlers, previewHandlers, sessionHandlers, shareHandlers } from "./hostMessages.js";
import { READER_LOG_MODULE, type HostContext, type HostState, type MessageAnswer, type MessageAnswers, type ReaderHostPorts } from "./hostPorts.js";

const HANDLERS: MessageAnswers = { ...sessionHandlers, ...annotationHandlers, ...shareHandlers, ...previewHandlers };

export interface ReaderHostOptions {
  /** Page to show once the reader has laid out the document. */
  page?: number;
}

export class ReaderHostController {
  private readonly state: HostState;
  private readonly ctx: HostContext;

  constructor(private readonly ports: ReaderHostPorts, options: ReaderHostOptions = {}) {
    const now = ports.now ?? Date.now;
    this.state = { themePreference: "auto", ready: false, held: new Map(), lastAnnotationsKey: "", openedAt: now() };
    this.ctx = {
      ports,
      state: this.state,
      now,
      effectiveTheme: (theme) => this.effectiveTheme(theme),
      pushAnnotations: (annotations, force) => this.pushAnnotations(annotations, force),
    };
    if (options.page !== undefined) { this.requestPage(options.page); }
  }

  /**
   * Entry point for every message the reader sends. Malformed messages are dropped and logged, never half-handled.
   * @returns resolves once the message has been handled; a failure becomes a logged error notice, never a rejection.
   */
  async handle(raw: unknown): Promise<void> {
    const { paper, logger } = this.ports;
    if (!isWebviewMessage(raw)) {
      void logger.log("WARN", READER_LOG_MODULE, "Ignored malformed reader message", { paperId: paper.id });
      return;
    }
    try {
      // The table pairs each command with its handler; TypeScript cannot correlate the union on lookup.
      await (HANDLERS[raw.command] as MessageAnswer<WebviewToHost["command"]>)(this.ctx, raw);
    } catch (err) {
      void logger.error(READER_LOG_MODULE, err, { paperId: paper.id, command: raw.command });
      this.ports.notify(`Reader action failed: ${formatError(err)}`, "error");
    }
  }

  /**
   * Papers whose reader theme is "auto" follow the host's theme.
   */
  onAutoThemeChange(effective: EffectiveTheme): void {
    if (this.state.themePreference === "auto") {
      this.ports.post({ type: "applyTheme", theme: "auto", effectiveTheme: effective });
    }
  }

  /**
   * Pushes the host's current reader preferences to the reader.
   */
  onPrefsChange(): void {
    this.ports.post({ type: "prefsChanged", prefs: this.ports.getPrefs() });
  }

  /**
   * Jumps to a page now if the document is laid out, or as soon as it is.
   */
  requestPage(page: number): void {
    if (!Number.isInteger(page) || page < 1) { return; }
    this.postWhenReady({ type: "scrollToPage", pageNumber: page });
  }

  /**
   * Re-reads the PDF in place after the host replaced the file, or shows the file at `pdfUrl` instead.
   */
  reloadDocument(pdfUrl?: string): void {
    this.postWhenReady(pdfUrl === undefined ? { type: "reloadDocument" } : { type: "reloadDocument", pdfUrl });
  }

  /**
   * Shows the state of the build behind a preview; `errors` is ignored unless the build failed.
   * `extra.stale` marks a PDF older than its sources and `extra.builtAt` is its last successful build in epoch milliseconds; each is sent only when given.
   */
  setBuildStatus(state: BuildState, errors = 0, extra: { stale?: boolean; builtAt?: number } = {}): void {
    const { stale, builtAt } = extra;
    this.postWhenReady({
      type: "buildStatus", state, errors: state === "failed" ? errors : 0,
      ...(stale === undefined ? {} : { stale }), ...(builtAt === undefined ? {} : { builtAt }),
    });
  }

  /**
   * Scrolls the reader to a point of the PDF and marks it.
   */
  revealPoint(point: PagePoint): void {
    this.postWhenReady({ type: "revealPoint", point });
  }

  /**
   * Shows the build roots of a writing project with their problems, replacing the earlier list.
   */
  setPreviewRoots(roots: PreviewBuildRoots): void {
    this.postWhenReady({ type: "previewRoots", roots });
  }

  /**
   * Opens the reader's problems view for a build root.
   */
  showLogs(root: string): void {
    this.postWhenReady({ type: "showLogs", root });
  }

  /**
   * Marks regions of the PDF as changed, replacing earlier marks.
   */
  showChanges(areas: PageArea[]): void {
    this.postWhenReady({ type: "showChanges", areas });
  }

  /**
   * Re-reads the sidecar and pushes the annotations if they changed, e.g. after a sync brought edits from another app.
   * @returns resolves once the sidecar was read and any change was posted.
   */
  async refreshAnnotations(): Promise<void> {
    if (!this.state.ready) { return; }
    this.pushAnnotations(await this.ports.store.getAnnotations(this.ports.paper.id), false);
  }

  // The reader drops these before it has laid out the document, so they wait for `ready`; only the latest of a type matters.
  private postWhenReady(msg: HostToWebview): void {
    if (this.state.ready) {
      this.ports.post(msg);
    } else {
      this.state.held.set(msg.type, msg);
    }
  }

  private pushAnnotations(annotations: Annotation[], force: boolean): void {
    const key = JSON.stringify(annotations);
    if (!force && key === this.state.lastAnnotationsKey) { return; }
    this.state.lastAnnotationsKey = key;
    this.ports.post({ type: "updateAnnotations", annotations });
  }

  private effectiveTheme(theme: PdfTheme): EffectiveTheme {
    return theme === "auto" ? this.ports.autoTheme() : theme;
  }
}
