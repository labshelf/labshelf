/** Exports what the editor inserts into LaTeX and Typst sources: math symbols, tables and image figures, as snippets. */
export { MATH_SYMBOLS, symbolSource } from "./symbolCatalog.js";
export type { MathSymbol, SymbolCategory } from "./symbolCatalog.js";
export { MAX_TABLE_SIDE, parseTableSize, tableSnippet } from "./tableSnippet.js";
export type { TableSize } from "./tableSnippet.js";
export { imageSnippet } from "./imageSnippet.js";
export { wrapSelection } from "./wrapSelection.js";
export type { WrapResult, WrapStyle } from "./wrapSelection.js";
export { IMAGE_EXTENSIONS, IMAGE_FOLDER, freeImageName, imageBaseFolder } from "./imagePlacement.js";
