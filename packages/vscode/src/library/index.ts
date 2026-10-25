/** Exports the library host: its services, change events, conflict copies and library-location flows. */
export { ConflictHandling, registerConflictCommand } from "./conflicts/index.js";
export { registerSyncGuideCommand } from "./syncGuide/index.js";
export { PaperImporter } from "./paperImporter.js";
export { PaperFileService } from "./paperFileService.js";
export { PaperService } from "./paperService.js";
export { PaperTextLayers } from "./paperTextLayers.js";
export type { MakeSearchableResult } from "./paperTextLayers.js";
export { createLibraryEvents, onPaperChange, type LibraryEvents } from "./libraryEvents.js";
