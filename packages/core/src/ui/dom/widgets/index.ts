/**
 * Public API of the overlay widgets: menu, dialog, quick input and toast.
 */
export { showMenu, closeMenu, type MenuItem, type MenuEntry, type MenuAnchor, type MenuOptions } from "./menu.js";
export { showDialog, confirmDialog, type DialogButton, type DialogOptions } from "./dialog.js";
export { quickPick, inputBox, type QuickPickItem, type QuickPickOptions, type InputBoxOptions } from "./quickInput.js";
export { toast, type ToastKind } from "./toast.js";
