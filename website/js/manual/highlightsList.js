// Lists the manual's highlights in the side panel with their colour and section, and scrolls to one on click.

import { $, $$, escapeHtml, reducedMotion } from "../dom.js";

export function renderHighlights() {
  const marks = $$("#doc mark.h");
  $("#hlc").textContent = marks.length;
  $("#hls").innerHTML = marks
    .map((mark, k) => {
      mark.dataset.k = k;
      const section = mark.closest("section")?.querySelector("h2 .n")?.textContent;
      const colour = mark.dataset.m;
      return `<button data-m="${colour}" data-k="${k}">${escapeHtml(mark.textContent)}<small>${colour}${section ? ` · §${section}` : ""}</small></button>`;
    })
    .join("");
}

export function initHighlightsList() {
  renderHighlights();
  $("#hls").addEventListener("click", (e) => {
    const button = e.target.closest("[data-k]");
    if (!button) return;
    $(`#doc mark.h[data-k="${button.dataset.k}"]`).scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
  });
}
