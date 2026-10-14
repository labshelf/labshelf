// The overlay toolbar: its buttons, and the auto-hide that tucks it away while reading and brings it back on any sign of interest.

import { byId, viewer } from "../dom.js";
import { isPopoverOpen, onPopoverToggle } from "./popover.js";
import { isFindOpen, onFindToggle, toggleFind } from "./findBar.js";
import { openThemePopover } from "./themePopover.js";
import { toggleCheatsheet } from "../keyboard/cheatsheet.js";

const HIDE_AFTER_PX = 24;
const REVEAL_ZONE_PX = 48;
const toolbar = byId("toolbar");
const shell = byId("pdf-shell");
let visible = true;
let engaged = false;
let pointerY = null;
let lastTop = 0;
let down = 0;

function pinned() {
  return isFindOpen() || isPopoverOpen() || toolbar.contains(document.activeElement) || (pointerY !== null && pointerY < REVEAL_ZONE_PX);
}

function show(next) {
  if (next === visible) return;
  visible = next;
  toolbar.classList.toggle("rd-toolbar-hidden", !next);
  document.documentElement.classList.toggle("rd-chrome-hidden", !next);
}

function onScroll() {
  const top = viewer.scrollTop;
  const delta = top - lastTop;
  lastTop = top;
  if (delta > 0) down += delta; else down = 0;
  if (top < 8 || delta < 0 || pinned() || !engaged) show(true);
  else if (down > HIDE_AFTER_PX) show(false);
}

export function initToolbar() {
  const engage = () => { engaged = true; };
  for (const type of ["wheel", "touchmove", "pointerdown"]) viewer.addEventListener(type, engage, { passive: true });
  document.addEventListener("keydown", engage, { passive: true });
  viewer.addEventListener("scroll", onScroll, { passive: true });
  shell.addEventListener("mousemove", (e) => {
    pointerY = e.clientY - shell.getBoundingClientRect().top;
    if (pointerY < REVEAL_ZONE_PX) show(true);
  }, { passive: true });
  shell.addEventListener("mouseleave", () => { pointerY = null; });
  toolbar.addEventListener("focusin", () => show(true));
  onPopoverToggle((open) => { if (open) show(true); });
  onFindToggle((open) => { if (open) show(true); });

  byId("find-toggle").addEventListener("click", toggleFind);
  byId("theme-toggle").addEventListener("click", () => openThemePopover(byId("theme-toggle")));
  byId("help-toggle").addEventListener("click", toggleCheatsheet);
}
