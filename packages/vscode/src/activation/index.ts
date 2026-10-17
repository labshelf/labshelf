// Exports everything extension.ts needs to compose and register the extension at activation.
export { startAiService } from "./serviceComposition/index.js";
export { LibraryRootController, SyncControllerLifecycle, ExternalChangeHandling } from "./libraryLifecycle/index.js";
export {
  registerLibrarySidebar,
  registerLibraryCommands,
  registerSettingsMenu,
  registerPanelCommands,
  registerSyncCommands,
  registerWritingView,
} from "./registration/index.js";
