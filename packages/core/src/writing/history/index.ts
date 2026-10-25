// Exports the runtime-neutral project history: the log format, recording and restoring over a storage port, the changes of an entry, the line diff and the page protocol.
export { isProjectPath, parseHistoryLine, serializeHistoryLine, type HistoryEntry, type HistoryKind } from "./historyEntry.js";
export { deriveEntryChanges, type FileChange, type FileChangeKind } from "./historyChanges.js";
export { compareLines, type DiffLine, type DiffLineKind } from "./compareLines.js";
export * from "./protocol/index.js";
export { readHistory, writeSnapshot, applySnapshot } from "./projectHistory.js";
export { readHistoryDiff, readHistoryRows, type HistoryRow } from "./historyViews.js";
export type { HistoryStorage, HistoryProject } from "./historyStorage.js";
