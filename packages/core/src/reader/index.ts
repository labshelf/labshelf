/** Exports the reader's runtime-neutral public API: protocol, host controller, sidecar store, preferences, themes, citation formats, toolbar auto-hide, hover crop geometry and the outline model.
 * The reader UI is exported from `dom/`. */
export * from "./protocol/index.js";
export * from "./previewProtocol.js";
export * from "./derivePreviewProblems.js";
export * from "./previewRequests.js";
export * from "./sidecar/index.js";
export * from "./themePresets.js";
export * from "./citationFormat.js";
export * from "./annotationsMarkdown.js";
export * from "./readerPrefs.js";
export * from "./shell.js";
export * from "./host/index.js";
export * from "./autohide.js";
export * from "./hoverCrop.js";
export * from "./outlineModel.js";
export * from "./deriveOutlineTrail.js";
