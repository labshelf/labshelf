/** Exports the runtime-neutral project history and versions: the log format, recording and restoring over a storage port, the changes of an entry, the line diff, the page protocol and the page comparison between two renderings of a paper. */
export { parseHistoryLine, serializeHistoryLine, deriveEntryChanges, compareLines, readHistory, writeSnapshot, applySnapshot, readHistoryDiff, readHistoryRows } from "./historyEntries.js";
export type { HistoryEntry, HistoryKind, FileChange, FileChangeKind, DiffLine, DiffLineKind, HistoryStorage, HistoryProject } from "./historyEntries.js";
export type { HistoryRow, HistoryToHost, HistoryTransport, HostToHistory } from "./protocol.js";
export { parseHistoryMessage } from "./protocol.js";
export { comparePdfPages } from "./versionDiff.js";
export type { PdfChanges } from "./versionDiff.js";
export { derivePageInk } from "./pageBlocks.js";
export type { PageInk } from "./pageBlocks.js";
