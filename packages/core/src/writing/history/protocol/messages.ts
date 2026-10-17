// Declares the messages between the project history page and its host, and the channel that carries them.
import type { MessageEnd } from "../../../library-ui/protocol/index.js";
import type { FileChange } from "../historyChanges.js";
import type { HistoryKind } from "../historyEntry.js";
import type { DiffLine } from "../lineDiff.js";

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
