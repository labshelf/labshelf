// Exports the Details surface's public API: its protocol and the selection hub that decides what it shows.
export type { DetailsTarget, DetailsToHost, HostToDetails } from "./protocol/index.js";
export { parseDetailsMessage } from "./protocol/index.js";
export { createSelectionHub, type SelectionHub } from "./selectionHub.js";
