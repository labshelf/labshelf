// One popover at a time, anchored above or below a button: the zoom menu and the theme picker.

import { byId, h, clamp } from "../dom.js";

const el = byId("popover");
const listeners = new Set();
let anchorEl = null;

function emit() { for (const fn of listeners) fn(!el.hidden); }

export function isPopoverOpen() { return !el.hidden; }
export function onPopoverToggle(fn) { listeners.add(fn); }

export function closePopover() {
  if (el.hidden) return;
  el.hidden = true;
  el.replaceChildren();
  anchorEl?.setAttribute("aria-expanded", "false");
  anchorEl = null;
  emit();
}

function position(anchor, placement) {
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  const left = placement === "below" ? r.right - w : r.left + r.width / 2 - w / 2;
  let top = placement === "below" ? r.bottom + 4 : r.top - hgt - 6;
  if (top + hgt > window.innerHeight - 8) top = r.top - hgt - 6;
  if (top < 8) top = r.bottom + 4;
  el.style.left = `${clamp(left, 8, window.innerWidth - w - 8)}px`;
  el.style.top = `${top}px`;
}

/** Open `content` next to `anchor`, or close it when the same anchor is clicked again. */
export function togglePopover(anchor, content, placement = "below") {
  if (anchorEl === anchor && !el.hidden) { closePopover(); return; }
  closePopover();
  el.className = "rd-popover";
  el.replaceChildren(content);
  el.hidden = false;
  anchorEl = anchor;
  anchor.setAttribute("aria-expanded", "true");
  position(anchor, placement);
  emit();
  el.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
}

/** A radio-style menu: `{ label, checked?, separatorBefore?, run }` per item. */
export function buildMenu(items) {
  const menu = h("div", { class: "rd-menu", role: "menu" });
  for (const item of items) {
    if (item.separatorBefore) menu.append(h("div", { class: "rd-menu-sep" }));
    const button = h("button", { class: "rd-menu-item", type: "button", role: "menuitemradio", "aria-checked": String(Boolean(item.checked)) },
      item.label);
    button.addEventListener("click", () => { closePopover(); item.run(); });
    menu.append(button);
  }
  return menu;
}

document.addEventListener("mousedown", (e) => {
  if (!el.hidden && !el.contains(e.target) && !anchorEl?.contains(e.target)) closePopover();
});
