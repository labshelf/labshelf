// Builds the reader's outline from the manual's headings and marks the section being read.

import { $, $$, escapeHtml } from "../dom.js";
import { HEADINGS } from "./sections.js";

// Distance from the viewport top, below the sticky bars, at which a heading counts as the one being read.
const READING_LINE = 160;

export function initOutline() {
  $("#toc").innerHTML = HEADINGS.map(
    (h) => `<a href="#${h.id}" data-id="${h.id}" class="${h.sub ? "s" : ""}"><span>${h.number}</span>${escapeHtml(h.title)}</a>`,
  ).join("");
  const links = $$("#toc a");
  const pageIndicator = $("#pgind");
  const markCurrent = () => {
    let current = HEADINGS[0];
    for (const h of HEADINGS) if (h.el.getBoundingClientRect().top < READING_LINE) current = h;
    for (const link of links) link.classList.toggle("on", link.dataset.id === current.id);
    pageIndicator.textContent = `§${current.number}`;
  };
  addEventListener("scroll", markCurrent, { passive: true });
  markCurrent();
}
