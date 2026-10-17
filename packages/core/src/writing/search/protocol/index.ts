// Exports the project search page protocol: its messages and their validation.
export type { HostToSearch, MatchLocation, SearchScopeLabel, SearchScopeMode, SearchToHost, SearchTransport } from "./messages.js";
export { parseSearchMessage } from "./parseSearchMessage.js";
