/** Lists the reader's actions and the key tables that trigger them: conventional, vim and preview-only. */

export type ReaderAction =
  | "scrollDown" | "scrollUp" | "scrollLeft" | "scrollRight"
  | "pageDown" | "pageUp" | "halfPageDown" | "halfPageUp"
  | "nextPage" | "prevPage" | "firstPage" | "lastPage"
  | "find" | "findNext" | "findPrev"
  | "zoomIn" | "zoomOut" | "zoomReset" | "fitWidth" | "fitPage"
  | "historyBack" | "historyForward"
  | "goToPage" | "toggleSidebar" | "cheatsheet" | "copyWithCitation" | "escape"
  | "recompile" | "nextProblem" | "prevProblem";

export interface Binding {
  key: string;
  action: ReaderAction;
  /** Platform primary modifier: Cmd on macOS, Ctrl elsewhere. */
  mod?: boolean;
  alt?: boolean;
  /** undefined = irrelevant (the shifted character is already in `key`, e.g. "?" or "N"). */
  shift?: boolean;
  macOnly?: boolean;
  label: string;
  group: "Navigate" | "Search" | "Zoom" | "View" | "Preview";
}

export const CONVENTIONAL: readonly Binding[] = [
  { key: "ArrowDown", action: "scrollDown", label: "Scroll down", group: "Navigate" },
  { key: "ArrowUp", action: "scrollUp", label: "Scroll up", group: "Navigate" },
  { key: "ArrowRight", action: "nextPage", label: "Next page", group: "Navigate" },
  { key: "ArrowLeft", action: "prevPage", label: "Previous page", group: "Navigate" },
  { key: "PageDown", action: "pageDown", label: "Scroll one screen down", group: "Navigate" },
  { key: " ", shift: false, action: "pageDown", label: "Scroll one screen down", group: "Navigate" },
  { key: "PageUp", action: "pageUp", label: "Scroll one screen up", group: "Navigate" },
  { key: " ", shift: true, action: "pageUp", label: "Scroll one screen up", group: "Navigate" },
  { key: "Home", action: "firstPage", label: "First page", group: "Navigate" },
  { key: "End", action: "lastPage", label: "Last page", group: "Navigate" },
  { key: "g", mod: true, alt: true, action: "goToPage", label: "Go to page", group: "Navigate" },
  { key: "ArrowLeft", alt: true, action: "historyBack", label: "Back", group: "Navigate" },
  { key: "ArrowRight", alt: true, action: "historyForward", label: "Forward", group: "Navigate" },
  { key: "[", mod: true, macOnly: true, action: "historyBack", label: "Back", group: "Navigate" },
  { key: "]", mod: true, macOnly: true, action: "historyForward", label: "Forward", group: "Navigate" },
  { key: "f", mod: true, action: "find", label: "Find in document", group: "Search" },
  { key: "g", mod: true, shift: false, action: "findNext", label: "Next match", group: "Search" },
  { key: "g", mod: true, shift: true, action: "findPrev", label: "Previous match", group: "Search" },
  { key: "F3", shift: false, action: "findNext", label: "Next match", group: "Search" },
  { key: "F3", shift: true, action: "findPrev", label: "Previous match", group: "Search" },
  { key: "=", mod: true, action: "zoomIn", label: "Zoom in", group: "Zoom" },
  { key: "+", mod: true, action: "zoomIn", label: "Zoom in", group: "Zoom" },
  { key: "-", mod: true, action: "zoomOut", label: "Zoom out", group: "Zoom" },
  { key: "0", mod: true, action: "zoomReset", label: "Reset zoom to default", group: "Zoom" },
  { key: "F4", action: "toggleSidebar", label: "Toggle sidebar", group: "View" },
  { key: "c", mod: true, shift: true, action: "copyWithCitation", label: "Copy selection with citation", group: "View" },
  { key: "?", action: "cheatsheet", label: "Keyboard shortcuts", group: "View" },
  { key: "Escape", action: "escape", label: "Close find / popups", group: "View" },
];

export const VIM: readonly Binding[] = [
  { key: "j", action: "scrollDown", label: "Scroll down", group: "Navigate" },
  { key: "k", action: "scrollUp", label: "Scroll up", group: "Navigate" },
  { key: "h", action: "scrollLeft", label: "Scroll left", group: "Navigate" },
  { key: "l", action: "scrollRight", label: "Scroll right", group: "Navigate" },
  { key: "d", action: "halfPageDown", label: "Half screen down", group: "Navigate" },
  { key: "u", action: "halfPageUp", label: "Half screen up", group: "Navigate" },
  { key: "J", action: "nextPage", label: "Next page", group: "Navigate" },
  { key: "K", action: "prevPage", label: "Previous page", group: "Navigate" },
  { key: "G", action: "lastPage", label: "Last page", group: "Navigate" },
  { key: ":", action: "goToPage", label: "Go to page", group: "Navigate" },
  { key: "H", action: "historyBack", label: "Back", group: "Navigate" },
  { key: "L", action: "historyForward", label: "Forward", group: "Navigate" },
  { key: "/", action: "find", label: "Find in document", group: "Search" },
  { key: "n", action: "findNext", label: "Next match", group: "Search" },
  { key: "N", action: "findPrev", label: "Previous match", group: "Search" },
  { key: "+", action: "zoomIn", label: "Zoom in", group: "Zoom" },
  { key: "=", action: "zoomIn", label: "Zoom in", group: "Zoom" },
  { key: "-", action: "zoomOut", label: "Zoom out", group: "Zoom" },
  { key: "w", action: "fitWidth", label: "Fit width", group: "Zoom" },
  { key: "e", action: "fitPage", label: "Fit page", group: "Zoom" },
  { key: "t", action: "toggleSidebar", label: "Toggle sidebar", group: "View" },
];

/** Active only in a reader that previews a build. */
export const PREVIEW: readonly Binding[] = [
  { key: "s", mod: true, action: "recompile", label: "Recompile", group: "Preview" },
  { key: "F8", shift: false, action: "nextProblem", label: "Next problem", group: "Preview" },
  { key: "F8", shift: true, action: "prevProblem", label: "Previous problem", group: "Preview" },
];
