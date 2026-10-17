// Exports the project history page protocol: its messages and their validation.
export type { HistoryRow, HistoryToHost, HistoryTransport, HostToHistory } from "./messages.js";
export { parseHistoryMessage } from "./parseHistoryMessage.js";
