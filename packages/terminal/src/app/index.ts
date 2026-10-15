// Exports the terminal app's public API: configuration and the opened-library context.
export { isSortKey, loadTerminalConfig, resolveLibraryRoot, SORT_KEYS, type SortKey, type TerminalConfig } from "./config.js";
export { openLibrary, type AppContext } from "./context.js";
