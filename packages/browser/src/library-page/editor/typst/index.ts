// Exports the Typst editor support: highlighting plus Tinymist completion, hover, definition and diagnostics over the helper.
export { goToDefinition, type DefinitionTarget } from "./goToDefinition";
export { hoverSource } from "./hoverSource";
export { lspDiagnostics } from "./lspDiagnostics";
export { openTypstDocument, type LspDiagnostic, type TypstDocument } from "./lsp";
export { typstCompletion } from "./typstCompletion";
export { typstLanguage } from "./typstLanguage";
export { typstSupport, type TypstSupport, type TypstSupportDeps } from "./typstSupport";
