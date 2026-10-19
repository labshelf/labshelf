// Exposes the lexical Typst scanner: the context at a cursor and the symbols a file defines.
export { scanTypstFile } from "./scanTypstFile.js";
export { typstContextAt } from "./typstContextAt.js";
export type { TypstMode } from "./walk/index.js";
export type {
  TypstBinding,
  TypstCursorContext,
  TypstFileSymbols,
  TypstImport,
  TypstLabelDefinition,
  TypstPathReference,
} from "./typstSyntaxTypes.js";
