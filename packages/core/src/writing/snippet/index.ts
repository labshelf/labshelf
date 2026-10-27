/** Exports what the editor inserts into LaTeX and Typst sources: math symbols, tables and image figures, as snippets. */
export { MATH_SYMBOLS, deriveSymbolSource } from "./symbolCatalog.js";
export type { MathSymbol, SymbolKind } from "./symbolCatalog.js";
export {
  MAX_TABLE_SIDE, parseTableSize, createTableSnippet, createImageSnippet, deriveSelectionWrap,
  IMAGE_EXTENSIONS, IMAGE_FOLDER, findFreeImageName, deriveImageBaseFolder,
} from "./snippets.js";
export type { EmptyTableSpec, WrapResult, WrapKind } from "./snippets.js";
