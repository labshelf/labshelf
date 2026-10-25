/** Exports the reader startup group's public API: the steps startReader runs to bring an open document to life. */
export { buildReaderUi } from "./buildReaderUi.js";
export { DeferredHover } from "./deferredHover.js";
export { attachExternalUrls } from "./externalUrls.js";
export { reportFirstRender } from "./firstRenderReport.js";
export { attachReaderHostMessages } from "./hostMessages.js";
export { PositionRestore } from "./restoreReadingPosition.js";
export { createActionRunner } from "./readerActions.js";
