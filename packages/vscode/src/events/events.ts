/**
 * Centralizes extension event name constants used across the event bus.
 */
export const EVENTS = {
  PAPER_ADDED: "paper:added",
  PAPER_UPDATED: "paper:updated",
  PAPER_DELETED: "paper:deleted",
  PDF_VIEWER_CLOSED: "pdf:viewer:closed",
  ANNOTATION_CREATED: "annotation:created",
  ANNOTATION_UPDATED: "annotation:updated",
  ANNOTATION_DELETED: "annotation:deleted",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
