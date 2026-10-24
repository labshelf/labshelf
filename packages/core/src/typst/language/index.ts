// Exposes the runtime-neutral Typst language service and the syntax types its callers may need.
export { createTypstLanguageService } from "./typstLanguageService.js";
export type {
  TypstCompletion,
  TypstCompletionKind,
  TypstCompletions,
  TypstDefinition,
  TypstHover,
  TypstLanguageService,
  TypstSources,
} from "./typstLanguageSpec.js";
export type { TypstCursorContext, TypstFileSymbols, TypstMode } from "./syntax/index.js";
