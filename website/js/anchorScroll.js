// Scrolls to in-page link targets and keeps the address bar on the target without adding history entries.

import { reducedMotion } from "./dom.js";
import { hidePopover } from "./popover.js";

export function initAnchorScroll() {
  document.addEventListener("click", (e) => {
    const link = e.target.closest('a[href^="#"]');
    const id = link?.getAttribute("href").slice(1);
    const target = id && document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    hidePopover();
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
  });
}
