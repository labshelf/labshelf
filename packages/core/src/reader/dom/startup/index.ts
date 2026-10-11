/** Public surface of the reader startup group: the steps startReader runs to bring an open document to life. */
export { buildReaderUi, type ReaderUi } from "./buildReaderUi.js";
export { DeferredHover } from "./deferredHover.js";
export { interceptExternalLinks } from "./externalLinks.js";
export { reportFirstRender } from "./firstRenderReport.js";
export { bindHostMessages } from "./hostMessages.js";
export { PositionRestore } from "./positionRestore.js";
export { createActionRunner } from "./readerActions.js";
