// Exports the editor area's public API: the workspace, its shell and the tab registry.
export { createWorkspace, createPageShell, JOIN_PREFIX, extractJoinInvite, type Workspace, type PageShell } from "./workspace";
export { TAB_KINDS, parseTab, type ProjectServices, type TabContext, type TabKindName } from "./tabKinds";
