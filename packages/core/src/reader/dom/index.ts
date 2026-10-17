/** Exports the reader UI apps start: the reader entry point and the pieces hosts plug into it. */
export { startReader } from "./reader.js";
export { createInPageChannel, type InPageChannel } from "./inPageChannel.js";
export { PerfMarks, type ReaderTransport } from "./session/index.js";
