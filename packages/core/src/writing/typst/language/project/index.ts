// Exposes the project side of the Typst language service: per-request file reads, paths and cross-file symbols.
export { projectFiles, type ProjectFile, type ProjectFiles } from "./projectFiles.js";
export { lineAt, relativeTypstPath, resolveTypstPath } from "./projectPaths.js";
export { importedSymbols, linkedLabels, projectBibEntries, type ImportedSymbols, type Located } from "./projectSymbols.js";
