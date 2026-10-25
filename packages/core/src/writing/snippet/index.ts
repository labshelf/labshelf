/** Exports what the editor inserts into LaTeX and Typst sources: math symbols, tables and image figures, as snippets. */
export { MATH_SYMBOLS, deriveSymbolSource } from "./symbolCatalog.js";
export type { MathSymbol, SymbolKind } from "./symbolCatalog.js";
export { MAX_TABLE_SIDE, parseTableSize, createTableSnippet } from "./emptyTable.js";
export type { EmptyTableSpec } from "./emptyTable.js";
export { createImageSnippet } from "./figureSnippet.js";
export { deriveSelectionWrap } from "./deriveSelectionWrap.js";
export type { WrapResult, WrapKind } from "./deriveSelectionWrap.js";
export { IMAGE_EXTENSIONS, IMAGE_FOLDER, findFreeImageName, deriveImageBaseFolder } from "./figurePlacement.js";
