// Exports the browser's disk mirror of a shared project, guarded by its tab and folder leases.
export {
  startBrowserProjectMirror, type BrowserMirrorStart, type BrowserMirrorStopReason, type BrowserProjectMirror, type BrowserProjectMirrorOptions,
} from "./browserProjectMirror";
export { reportPageWrites } from "./localFileChanges";
