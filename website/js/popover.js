// Shows one popover at a time next to the element it describes, and hides it once the pointer leaves both.

import { $ } from "./dom.js";

const pop = $("#pop");
const GAP = 8;
let owner = null;
let hideTimer;

function placeNextTo(el) {
  const r = el.getBoundingClientRect();
  const overflowsBelow = r.bottom + GAP + pop.offsetHeight > innerHeight - GAP;
  const fitsAbove = r.top - pop.offsetHeight - GAP > GAP;
  const top = overflowsBelow && fitsAbove ? r.top - pop.offsetHeight - GAP : r.bottom + GAP;
  pop.style.top = `${top + scrollY}px`;
  pop.style.left = `${Math.max(GAP, Math.min(r.left + scrollX - 16, innerWidth - pop.offsetWidth - GAP + scrollX))}px`;
}

export function showPopover(el, html, className = "") {
  clearTimeout(hideTimer);
  owner = el;
  pop.className = `pop ${className}`;
  pop.innerHTML = html;
  pop.hidden = false;
  placeNextTo(el);
}

export function hidePopover() {
  clearTimeout(hideTimer);
  pop.hidden = true;
  owner?.classList.remove("on");
  owner = null;
}

export function hidePopoverSoon(delay) {
  hideTimer = setTimeout(hidePopover, delay);
}

export const popoverOwner = () => owner;

export function onPopoverClick(handler) {
  pop.addEventListener("click", handler);
}

export function initPopover() {
  pop.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  pop.addEventListener("mouseleave", () => hidePopoverSoon(250));
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest("#pop, .cit, .xref")) hidePopover();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hidePopover();
  });
}
