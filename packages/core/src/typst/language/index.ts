/** Exports the Typst language service (completion, hover and definition) and the light syntax and project reading it is built on, such as scanning headings and resolving a written path.
 * It is the `@labshelf/core/typst/language` entry; it never imports the compiler, so writing and editors use it without loading typst.ts. */
export { createTypstLanguageService } from "./service.js";
export type {
  TypstCompletion, TypstCompletionKind, TypstCompletions, TypstDefinition, TypstHover, TypstLanguageService,
} from "./service.js";
export { derivePlainHoverText } from "./hoverText.js";
export { resolveTypstPath } from "./project.js";
export type { TypstSources } from "./project.js";
export { scanTypstHeadings } from "./syntax.js";
export type { TypstCursorContext, TypstFileSymbols, TypstHeading } from "./syntax.js";
export type { TypstMode } from "./syntaxWalk.js";
