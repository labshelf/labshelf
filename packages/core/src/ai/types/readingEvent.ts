// Defines the reading-activity events (open, scroll, annotate, close) emitted by the PDF viewer.
export type ReadingEventKind = "open" | "scroll" | "annotate" | "close";

export interface ReadingEvent {
  paperId: string;
  kind: ReadingEventKind;
  page?: number;
  occurredAt: number;
  durationMs?: number;
  topicCluster?: string;
}
