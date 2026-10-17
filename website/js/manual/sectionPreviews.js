// Previews the section a cross-reference points to while the pointer rests on it.

import { escapeHtml } from "../dom.js";
import { hidePopoverSoon, popoverOwner, showPopover } from "../popover.js";
import { sectionSummary } from "./sections.js";

const sentenceCase = (text) => text.charAt(0) + text.slice(1).toLowerCase();

export function initSectionPreviews() {
  document.addEventListener("mouseover", (e) => {
    const xref = e.target.closest(".xref");
    if (!xref || popoverOwner() === xref) return;
    const section = sectionSummary(xref.getAttribute("href").slice(1));
    if (!section) return;
    const number = escapeHtml(section.number);
    showPopover(
      xref,
      `<div class="t1">§${number}</div><h5>${escapeHtml(sentenceCase(section.title))}</h5><p>${escapeHtml(section.text)}</p><span class="go">click to go to §${number}</span>`,
      "x",
    );
  });
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest(".xref")) hidePopoverSoon(200);
  });
}
