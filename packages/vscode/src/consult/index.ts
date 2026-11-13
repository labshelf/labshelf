// The VS Code host side of the consult window: the ConsultIo its requests are answered over and the per-panel file sessions of its windows.
export { createVscodeConsultIo, type VscodeConsultDeps } from "./consultIo.js";
export { createConsultFiles, type ConsultFilesDeps } from "./consultFiles.js";
