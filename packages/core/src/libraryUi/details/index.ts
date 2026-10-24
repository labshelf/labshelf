// Exports the Details surface's public API: its protocol, the selection hub that decides what it shows, and its tab state.
export type { DetailsTarget, DetailsToHost, HostToDetails } from "./protocol/index.js";
export { parseDetailsMessage } from "./protocol/index.js";
export { createSelectionHub, type SelectionHub } from "./selectionHub.js";
export {
  closeTab, initialTabs, isPinnable, pinPreview, pruneTabs, receiveTarget, selectTab, shownTarget, type DetailsTabsState,
} from "./detailsTabs.js";
