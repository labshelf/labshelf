// Exports everything extension.ts needs to compose and register the extension at activation.
export { startAiService } from "./serviceComposition/index.js";
export { LibraryRootController, SyncControllerLifecycle, ExternalChangeHandling } from "./libraryLifecycle/index.js";
export {
  registerLibraryTreeView,
  registerLibraryCommands,
  registerSettingsView,
  registerPanelCommands,
  registerSyncCommands,
} from "./registration/index.js";
