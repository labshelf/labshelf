/** Public surface of the reader UI that apps start: the reader entry point and the pieces hosts plug into it. */
export { startReader } from "./reader.js";
export { byId } from "./elements/index.js";
export { PerfMarks, type ReaderTransport } from "./session/index.js";
