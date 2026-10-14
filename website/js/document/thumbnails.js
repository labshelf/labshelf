// The Thumbnails tab: scaled copies of every page, built when the tab is first shown, with the page in view marked active.

import { byId, h, pages } from "../dom.js";
import { goToPage, onPageChange, currentPage } from "./navigation.js";
import { onTabShow } from "../chrome/sidebar.js";

let built = false;

/** A static copy of a page: no ids, posters instead of videos, no find marks or copy buttons. */
function clonePage(page) {
  const clone = page.cloneNode(true);
  clone.removeAttribute("id");
  for (const el of clone.querySelectorAll("[id]")) el.removeAttribute("id");
  for (const video of clone.querySelectorAll("video")) {
    const img = h("img", { src: video.getAttribute("poster"), class: video.className, alt: "" });
    video.replaceWith(img);
  }
  for (const el of clone.querySelectorAll(".copy")) el.remove();
  for (const mark of clone.querySelectorAll("mark.rd-find-hit")) mark.replaceWith(...mark.childNodes);
  clone.setAttribute("inert", "");
  return clone;
}

function build() {
  const list = byId("thumbnails");
  for (const page of pages()) {
    const n = Number(page.dataset.page);
    const frame = h("div", { class: "rd-thumb-frame" }, clonePage(page));
    // A page that outgrew the Letter format keeps its real proportions in the thumbnail.
    frame.style.aspectRatio = `${page.offsetWidth} / ${page.offsetHeight}`;
    const thumb = h("button", { class: "rd-thumb", type: "button", "data-page": n, title: `Page ${n}` },
      frame, h("span", { class: "rd-thumb-label" }, String(n)));
    thumb.addEventListener("click", () => goToPage(n));
    list.append(thumb);
  }
  built = true;
}

function markActive(page) {
  for (const thumb of document.querySelectorAll(".rd-thumb")) {
    const active = Number(thumb.dataset.page) === page;
    thumb.classList.toggle("rd-active", active);
    if (active && !thumb.closest(".rd-panel")?.hidden) thumb.scrollIntoView({ block: "nearest" });
  }
}

export function initThumbnails() {
  onTabShow("thumbnails", () => {
    if (!built) build();
    markActive(currentPage());
  });
  onPageChange((page) => { if (built) markActive(page); });
}
