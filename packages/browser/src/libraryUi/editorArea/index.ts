// Exports the editor area's public API: the workspace, its shell, the tab registry and the deck asset resolver.
export { createWorkspace, createPageShell, JOIN_PREFIX, extractJoinInvite, openDeckAudienceTab, type Workspace, type PageShell } from "./workspace";
export { TAB_KINDS, setPaperTitles, type ProjectServices, type TabContext } from "./tabKinds";
export { createDeckAssetResolver } from "./deckAssets";
