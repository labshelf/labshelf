/** Exports Typst in VS Code: the live and on-save compile triggers, the compiler version pin and whether the language server runs. */
export { languageServerRunning } from "./languageServerState.js";
export { registerTypstTriggers, type TypstTrigger } from "./typstTriggers.js";
export { recordTypstVersion } from "./typstVersionPin.js";
