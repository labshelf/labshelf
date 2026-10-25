// Exports the Typst editor support: highlighting plus completion, hover and definition from the core language service.
export type { DefinitionDeps } from "./openDefinition";
export { createTypstCompletion } from "./createTypstCompletion";
export { typstLanguage } from "./typstLanguage";
export { createTypstSupport } from "./createTypstSupport";
