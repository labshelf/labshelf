// Exports the Details surface protocol: its messages and the guard for untrusted ones.
export type { DetailsTarget, DetailsToHost, HostToDetails } from "./messages.js";
export { parseDetailsMessage } from "./parseDetailsMessage.js";
