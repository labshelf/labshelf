// Exports the editor area's public API: the workspace, its shell and the tab registry.
export { createWorkspace } from "./workspace";
export { createPageShell, type PageShell } from "./pageShell";
export type { Workspace } from "./workspace";
export { JOIN_PREFIX, takeJoinInvite } from "./workspaceHash";
export { TAB_KINDS, parseTabId } from "./tabKinds";
export type { ProjectServices, TabContext, TabHooks, TabKindName, TabParams, TabModule } from "./tabKind";
