// Keyboard handling: each keydown goes through the keymap and runs the reader action; the vim layer is a toggle persisted across visits.

import { viewer, isTyping, isMac, load, save, pages } from "../dom.js";
import { resolveKey, CHORD_TIMEOUT_MS } from "./keymap.js";
import { toggleCheatsheet, closeCheatsheet, isCheatsheetOpen, bindVimKeys } from "./cheatsheet.js";
import { goBack, goForward, goToPage, currentPage, scrollViewer } from "../document/navigation.js";
import { zoom } from "../document/zoom.js";
import { openFind, closeFind, isFindOpen, findNext, findPrev } from "../chrome/findBar.js";
import { toggleSidebar } from "../chrome/sidebar.js";
import { closePopover, isPopoverOpen } from "../chrome/popover.js";
import { copyWithCitation, hideBubble } from "../document/selection.js";
import { closeHover } from "../document/hover.js";
import { focusPageInput } from "../chrome/statusPill.js";

const KEY = "labshelf.site.vimKeys";
const LINE_PX = 40;
let vimKeys = load(KEY, false) === true;
let pendingPrefix = null;
let prefixTimer = 0;

function vimKeysEnabled() { return vimKeys; }
function setVimKeys(enabled) { vimKeys = enabled; save(KEY, enabled); }

function escape() {
  if (isCheatsheetOpen()) { closeCheatsheet(); return; }
  if (isPopoverOpen()) { closePopover(); return; }
  if (isFindOpen()) { closeFind(); return; }
  hideBubble();
  closeHover();
  window.getSelection()?.removeAllRanges();
}

const ACTIONS = {
  scrollDown: () => scrollViewer(LINE_PX),
  scrollUp: () => scrollViewer(-LINE_PX),
  scrollLeft: () => scrollViewer(0, -LINE_PX),
  scrollRight: () => scrollViewer(0, LINE_PX),
  pageDown: () => scrollViewer(viewer.clientHeight - LINE_PX),
  pageUp: () => scrollViewer(-(viewer.clientHeight - LINE_PX)),
  halfPageDown: () => scrollViewer(viewer.clientHeight / 2),
  halfPageUp: () => scrollViewer(-viewer.clientHeight / 2),
  nextPage: () => goToPage(currentPage() + 1),
  prevPage: () => goToPage(currentPage() - 1),
  firstPage: () => goToPage(1),
  lastPage: () => goToPage(pages().length),
  find: openFind,
  findNext,
  findPrev,
  zoomIn: () => zoom.zoomIn(),
  zoomOut: () => zoom.zoomOut(),
  zoomReset: () => zoom.reset(),
  fitWidth: () => zoom.setPreset("page-width"),
  fitPage: () => zoom.setPreset("page-fit"),
  historyBack: goBack,
  historyForward: goForward,
  goToPage: focusPageInput,
  toggleSidebar,
  cheatsheet: toggleCheatsheet,
  copyWithCitation,
  escape,
};

function onKeydown(e) {
  if (isCheatsheetOpen() && e.key !== "Escape" && e.key !== "?") return;
  const input = { key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey };
  const ctx = { vimKeys, isMac, inTextInput: isTyping(e.target), pendingPrefix };
  const { action, pendingPrefix: next } = resolveKey(input, ctx);
  clearTimeout(prefixTimer);
  pendingPrefix = next;
  if (next) prefixTimer = setTimeout(() => { pendingPrefix = null; }, CHORD_TIMEOUT_MS);
  if (!action) return;
  e.preventDefault();
  ACTIONS[action]();
}

export function initKeys() {
  bindVimKeys(vimKeysEnabled, setVimKeys);
  document.addEventListener("keydown", onKeydown);
}
