// Exports the terminal app's public API: configuration and the opened-library context.
export { loadTerminalConfig, resolveLibraryRoot, type SortKey, type TerminalConfig } from "./config.js";
export { openLibrary, type AppContext } from "./context.js";
