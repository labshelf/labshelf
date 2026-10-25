/**
 * Reports the reading position (page, zoom, offset, sidebar) to the host for persistence, debounced while reading and flushed when the panel hides.
 */
import type { ReadingState } from "../../index.js";
import { createDebouncer, isPresetScale } from "../../navigation/index.js";
import type { PdfPosition, ReaderContext } from "../session/index.js";
import type { Sidebar } from "../sidebar/index.js";

const SAVE_DEBOUNCE_MS = 800;

export class ReadingPositionReporter {
  private location: PdfPosition | null = null;
  private enabled = false;
  private readonly save = createDebouncer(() => this.post(), SAVE_DEBOUNCE_MS);

  constructor(private readonly ctx: ReaderContext, private readonly sidebar: Sidebar) {
    ctx.eventBus.on("updateviewarea", (evt: { location?: PdfPosition }) => {
      if (!evt.location) { return; }
      this.location = evt.location;
      if (this.enabled) { this.save.call(); }
    });
    sidebar.onChange(() => { if (this.enabled) { this.save.call(); } });
    document.addEventListener("visibilitychange", () => { if (document.hidden) { this.save.flush(); } });
    window.addEventListener("pagehide", () => this.save.flush());
  }

  /**
   * Reporting starts only after restore, so the initial page-1 layout never overwrites the stored position.
   */
  start(): void {
    this.enabled = true;
  }

  private post(): void {
    const loc = this.location;
    if (!loc) { return; }
    const value = this.ctx.pdfViewer.currentScaleValue;
    const state: ReadingState = {
      page: loc.pageNumber,
      // A preset survives window resizes; a number pins the exact zoom the reader chose.
      scaleValue: isPresetScale(value) ? value : String(this.ctx.pdfViewer.currentScale),
      left: loc.left,
      top: loc.top,
      sidebar: this.sidebar.state,
      updatedAt: new Date().toISOString(),
    };
    this.ctx.host.post({ command: "saveReadingState", state });
  }
}
