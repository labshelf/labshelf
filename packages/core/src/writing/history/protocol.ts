/** Declares the project history page protocol: the messages between the page and its host, the channel that carries them, and the validation of a message from the page. */
import type { MessageEnd } from "../../libraryUi/protocol/index.js";
import type { FileChange, HistoryKind, DiffLine } from "./historyEntries.js";

// --- Messages ---

/** One entry as the page shows it. */
export interface HistoryRow {
  id: string;
  at: string;
  kind: HistoryKind;
  label?: string;
  changes: FileChange[];
}

export type HistoryToHost =
  | { type: "ready" }
  | { type: "diff"; id: string; path: string }
  | { type: "restore"; id: string }
  | { type: "markVersion" }
  | { type: "compareVersions" };

export type HostToHistory =
  /** Newest first; the first row is the project as it is on disk. */
  | { type: "history"; project: string; rows: HistoryRow[] }
  /** `lines` is null for a binary file. */
  | { type: "diff"; id: string; path: string; lines: DiffLine[] | null }
  | { type: "busy"; busy: boolean };

/** The page side of the channel. */
export type HistoryTransport = MessageEnd<HistoryToHost, HostToHistory>;

// --- Validation ---

/** The typed message, or undefined when any field is missing or of the wrong type. */
export function parseHistoryMessage(raw: unknown): HistoryToHost | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { return undefined; }
  const { type, id, path } = raw as Record<string, unknown>;
  switch (type) {
    case "ready": case "markVersion": case "compareVersions": return { type };
    case "diff": return typeof id === "string" && typeof path === "string" ? { type, id, path } : undefined;
    case "restore": return typeof id === "string" ? { type, id } : undefined;
    default: return undefined;
  }
}
