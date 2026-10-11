/**
 * Turns one reader panel's open, page, annotate, visibility and close moments into reading analytics events.
 */
import type { ReaderActivityPort, ReadingEvent } from "@labshelf/core";

// A page counts as read, for analytics, once the reader has stayed on it this long.
const MIN_DWELL_MS = 5000;

export type ReadingEventSink = (event: ReadingEvent) => void;

export class ReadingActivityTracker implements ReaderActivityPort {
  private readonly openedAt = Date.now();
  private pageEnteredAt = Date.now();
  private currentPage = 1;
  private visible = true;

  constructor(private readonly paperId: string, private readonly sink: ReadingEventSink | undefined) {}

  /** @returns void */
  opened(): void {
    this.pageEnteredAt = Date.now();
    this.emit({ kind: "open" });
  }

  /** @returns void */
  pageChanged(page: number): void {
    if (page === this.currentPage) { return; }
    this.recordDwell();
    this.currentPage = page;
  }

  /** @returns void */
  annotated(page: number): void {
    this.emit({ kind: "annotate", page });
  }

  /**
   * Time spent with the panel in the background is not reading time.
   * @returns void
   */
  visibilityChanged(visible: boolean): void {
    if (visible && !this.visible) {
      this.visible = true;
      this.pageEnteredAt = Date.now();
    } else if (!visible && this.visible) {
      this.recordDwell();
      this.visible = false;
    }
  }

  /**
   * Records the last page's dwell and the whole session.
   * @returns the page the reader was on when it closed.
   */
  closed(): number {
    this.recordDwell();
    this.emit({ kind: "close", page: this.currentPage, durationMs: Date.now() - this.openedAt });
    return this.currentPage;
  }

  private recordDwell(): void {
    const now = Date.now();
    const durationMs = now - this.pageEnteredAt;
    this.pageEnteredAt = now;
    if (durationMs >= MIN_DWELL_MS && this.visible) {
      this.emit({ kind: "scroll", page: this.currentPage, durationMs });
    }
  }

  private emit(event: Omit<ReadingEvent, "paperId" | "occurredAt">): void {
    try {
      this.sink?.({ paperId: this.paperId, occurredAt: Date.now(), ...event });
    } catch {
      // Analytics must never disturb reading.
    }
  }
}
