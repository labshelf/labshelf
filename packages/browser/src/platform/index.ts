/** Browser platform access shared by the extension's modules: the WebExtension API, the logger and the runtime message types. */
export { bx } from "./browserApi";
export { BrowserLogger } from "./logger";
export { downloadTextFile } from "./downloadTextFile";
export type {
  AttachPdfData, LibraryChangedBroadcast, RuntimeMessage, RuntimeResponse, SaveOutcome, SyncStatusData, TabSummary,
} from "./runtimeMessages";
