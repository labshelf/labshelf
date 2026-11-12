// Marks the section being read in the sidebar and the top bar, names it in the top bar, and opens only the manual chapter that holds it while a search lists the chapters.

import { $, $$ } from "../dom.js";

// Distance from the viewport top, below the sticky bar, at which a section counts as the one being read.
const READING_LINE = 140;

export function initNav() {
  const links = $$("[data-spy]").map((el) => ({ el, ids: el.dataset.spy.split(" ") }));
  // In page order, so the last one above the reading line is the one being read.
  const targets = [...new Set(links.flatMap((link) => link.ids))].map((id) => document.getElementById(id)).filter(Boolean)
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const crumb = $("#crumb");
  const tree = $("#tree");
  const markCurrent = () => {
    let current = targets[0];
    for (const target of targets) if (target.getBoundingClientRect().top < READING_LINE) current = target;
    for (const { el, ids } of links) {
      const on = ids.includes(current.id);
      // A row that just became current opens its chapter and closes the others; one already current leaves them as the reader set them. A search in progress keeps its own.
      if (on && !el.classList.contains("on") && !tree?.classList.contains("searching")) {
        for (const chapter of $$("#tree details.ch")) chapter.open = chapter.contains(el);
      }
      el.classList.toggle("on", on);
      if (on && el.dataset.crumb !== undefined) crumb.textContent = el.dataset.crumb;
    }
  };
  // A chapter's row is a link: following it opens the chapter instead of toggling it, so only the chevron collapses.
  for (const link of $$(".tree-sec summary > a")) {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      link.closest("details").open = true;
      location.hash = link.getAttribute("href");
    });
  }
  addEventListener("scroll", markCurrent, { passive: true });
  markCurrent();
}
