// Exports the runtime-neutral project history: the log format, the changes of an entry, the line diff and the page protocol.
export { isProjectPath, parseHistoryLine, serializeHistoryLine, type HistoryEntry, type HistoryKind } from "./historyEntry.js";
export { entryChanges, type FileChange, type FileChangeKind } from "./historyChanges.js";
export { lineDiff, type DiffLine, type DiffLineKind } from "./lineDiff.js";
export * from "./protocol/index.js";
