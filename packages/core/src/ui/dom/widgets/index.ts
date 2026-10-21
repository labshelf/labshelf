/**
 * Exports the widgets' public API: menu, dialog, quick input, toast, the Arc mark and the page-level widgets.
 */
export { showMenu, closeMenu, type MenuItem, type MenuEntry, type MenuAnchor, type MenuOptions } from "./menu.js";
export { showDialog, confirmDialog, type DialogButton, type DialogOptions } from "./dialog.js";
export { quickPick, inputBox, type QuickPickEntry, type QuickPickItem, type QuickPickOptions, type QuickPickSeparator, type InputBoxOptions } from "./quickInput.js";
export { toast, type ToastKind } from "./toast.js";
export { progressDialog, type ProgressDialog, type ProgressDialogOptions } from "./progressDialog.js";
export { arcMarkElement } from "./arcMark.js";
export { mountOverlay } from "./overlay.js";
export * from "./page/index.js";
