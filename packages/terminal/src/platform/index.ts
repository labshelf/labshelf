/** Exports the platform module's public API: operating-system access for directories, the clipboard, the browser, the trash and the editor. */
export { cacheDir, expandHome } from "./dirs.js";
export {
  copyToClipboard, hasCommand, moveToTrash, openExternal, revealInFileManager, runEditor, trashSupported,
} from "./system.js";
