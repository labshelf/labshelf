/** Exports the platform module's public API: operating-system access for directories, the clipboard, the browser, the trash and the editor. */
export { expandHome } from "./expandHome.js";
export {
  copyToClipboard, hasCommand, moveToTrash, openExternal, revealInFileManager, runEditor, trashSupported, viewerTakesPage,
} from "./system.js";
