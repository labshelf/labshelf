// Marks the section being read in the sidebar and the top bar, and names it next to the open tab.

import { $, $$ } from "../dom.js";

// Distance from the viewport top, below the sticky bar, at which a section counts as the one being read.
const READING_LINE = 140;

export function initNav() {
  const links = $$("[data-spy]").map((el) => ({ el, ids: el.dataset.spy.split(" ") }));
  const targets = [...new Set(links.flatMap((link) => link.ids))].map((id) => document.getElementById(id)).filter(Boolean);
  const crumb = $("#crumb");
  const markCurrent = () => {
    let current = targets[0];
    for (const target of targets) if (target.getBoundingClientRect().top < READING_LINE) current = target;
    for (const { el, ids } of links) {
      const on = ids.includes(current.id);
      el.classList.toggle("on", on);
      if (on && el.dataset.crumb !== undefined) crumb.textContent = el.dataset.crumb;
    }
  };
  addEventListener("scroll", markCurrent, { passive: true });
  markCurrent();
}
