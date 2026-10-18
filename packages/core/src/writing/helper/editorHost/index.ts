/** Exports the whole-project LaTeX helper calls and Typst compiles the web build makes to its editor page, with their wire form. */
export { compileResultFromWire, projectToWire } from "./latexHelperWire.js";
export type { WireProject } from "./latexHelperWire.js";
export type {
  EditorHostCompileResult, EditorHostLatexHelper, EditorHostProject, EditorHostProjectFile,
} from "./editorHostLatexHelper.js";
export { typstOutcomeFromWire, typstOutcomeToWire, typstRequestFromWire } from "./typstCompileWire.js";
export type { TypstHostOutcome, TypstHostRequest } from "./typstCompileWire.js";
