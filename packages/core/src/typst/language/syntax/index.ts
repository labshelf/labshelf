// Exposes the lexical Typst scanner: the context at a cursor, the symbols a file defines and its headings.
export { scanTypstFile } from "./scanTypstFile.js";
export { deriveTypstCursor } from "./typstCursor.js";
export type { TypstMode } from "./typstFrames.js";
export type {
  TypstBinding,
  TypstCursorContext,
  TypstFileSymbols,
  TypstImport,
  TypstLabelDefinition,
  TypstPathReference,
} from "./typstFileSymbols.js";
export { scanTypstHeadings } from "./typstHeadings.js";
export type { TypstHeading } from "./typstHeadings.js";
