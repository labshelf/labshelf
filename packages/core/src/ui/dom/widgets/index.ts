/**
 * Exports the widgets' public API: menu, dialog, quick input, toast and the Arc mark.
 */
export { showMenu, closeMenu, type MenuItem, type MenuEntry, type MenuAnchor, type MenuOptions } from "./menu.js";
export { showDialog, confirmDialog, type DialogButton, type DialogOptions } from "./dialog.js";
export { quickPick, inputBox, type QuickPickEntry, type QuickPickItem, type QuickPickOptions, type QuickPickSeparator, type InputBoxOptions } from "./quickInput.js";
export { toast, type ToastKind } from "./toast.js";
export { arcMarkElement } from "./arcMark.js";
