/**
 * The host side of the reader protocol: validates each reader message and answers it through the host's ports.
 */
import type { Annotation, PdfTheme } from "../../model/index.js";
import { isWebviewMessage, type EffectiveTheme, type WebviewToHost } from "../protocol.js";
import { annotationHandlers } from "./annotationMessages.js";
import { READER_LOG_MODULE, type HostContext, type HostState, type MessageHandler, type MessageHandlers } from "./hostContext.js";
import type { ReaderHostPorts } from "./ports.js";
import { sessionHandlers } from "./sessionMessages.js";
import { shareHandlers } from "./shareMessages.js";

const HANDLERS: MessageHandlers = { ...sessionHandlers, ...annotationHandlers, ...shareHandlers };

export interface ReaderHostOptions {
  /** Page to show once the reader has laid out the document. */
  page?: number;
}

export class ReaderHostController {
  private readonly state: HostState;
  private readonly ctx: HostContext;

  constructor(private readonly ports: ReaderHostPorts, options: ReaderHostOptions = {}) {
    const now = ports.now ?? Date.now;
    this.state = { themePreference: "auto", ready: false, pendingPage: undefined, lastAnnotationsKey: "", openedAt: now() };
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
      await (HANDLERS[raw.command] as MessageHandler<WebviewToHost["command"]>)(this.ctx, raw);
    } catch (err) {
      void logger.error(READER_LOG_MODULE, err, { paperId: paper.id, command: raw.command });
      this.ports.notify(`Reader action failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }

  /**
   * Papers whose reader theme is "auto" follow the host's theme.
   * @returns void
   */
  onAutoThemeChange(effective: EffectiveTheme): void {
    if (this.state.themePreference === "auto") {
      this.ports.post({ type: "applyTheme", theme: "auto", effectiveTheme: effective });
    }
  }

  /**
   * Pushes the host's current reader preferences to the reader.
   * @returns void
   */
  onPrefsChange(): void {
    this.ports.post({ type: "prefsChanged", prefs: this.ports.getPrefs() });
  }

  /**
   * Jumps to a page now if the document is laid out, or as soon as it is, because the reader drops scrollToPage before that.
   * @returns void
   */
  requestPage(page: number): void {
    if (!Number.isInteger(page) || page < 1) { return; }
    if (this.state.ready) {
      this.ports.post({ type: "scrollToPage", pageNumber: page });
    } else {
      this.state.pendingPage = page;
    }
  }

  /**
   * Re-reads the sidecar and pushes the annotations if they changed, e.g. after a sync brought edits from another app.
   * @returns resolves once the sidecar was read and any change was posted.
   */
  async refreshAnnotations(): Promise<void> {
    if (!this.state.ready) { return; }
    this.pushAnnotations(await this.ports.store.getAnnotations(this.ports.paper.id), false);
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
