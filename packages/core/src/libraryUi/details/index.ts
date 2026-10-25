// Exports the Details surface's public API: its protocol, the selection hub that decides what it shows, and its tab state.
export type { DetailsSelection, DetailsToHost, HostToDetails } from "./protocol/index.js";
export { parseDetailsMessage } from "./protocol/index.js";
export { createSelectionHub, type SelectionHub } from "./selectionHub.js";
export {
  closeTab, createInitialTabs, isPinnable, movePreviewToPinned, removeStaleTabs, applyDetailsSelection, setActiveTab, deriveShownSelection, type DetailsTabsState,
} from "./detailsTabs.js";
