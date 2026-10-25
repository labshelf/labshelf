/** Exports the platform module's public API: operating-system access for directories, the clipboard, the browser, the trash and the editor. */
export { resolveHomePath } from "./expandPath.js";
export {
  copyToClipboard, hasCommand, moveToTrash, openExternal, showInFileSystem, runEditor, canTrash, canReaderOpenPage,
} from "./system.js";
