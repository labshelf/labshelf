// Exports everything extension.ts needs to compose and register the extension at activation.
export { startAiService } from "./serviceComposition/index.js";
export { LibraryRootController, ExternalChangeHandling } from "./libraryLifecycle/index.js";
export {
  registerLibrarySidebar,
  registerLibraryCommands,
  registerSettingsMenu,
  registerPanelCommands,
  registerWritingView,
  registerBridgeCommand,
} from "./registration/index.js";
