// Runs the hero's tour: a tab, the step that names it, or a link inside a scene opens one scene at a time.

import { $, $$ } from "../dom.js";
import { initHeroScenes } from "./heroScenes.js";

export function initHeroTour() {
  const show = $("#show");
  if (!show) return;
  const tabs = $$("#show [role=tab]");
  const slides = $$("#show .hero-slide");
  const captions = $$("#show .hero-cap");
  const path = $$("#show .hero-path li");
  const steps = $$(".hero-step");

  function open(index) {
    tabs.forEach((tab, i) => tab.setAttribute("aria-selected", String(i === index)));
    for (const group of [slides, captions, path, steps]) group.forEach((el, i) => el.classList.toggle("on", i === index));
    // Each scene catches up with what the others changed.
    show.dispatchEvent(new CustomEvent("hero:open", { detail: index }));
  }

  tabs.forEach((tab, i) => tab.addEventListener("click", () => open(i)));
  // A step opens its tab; a scene's own links ("Open the note") jump to the tab they name.
  $(".hero").addEventListener("click", (e) => {
    const link = e.target.closest("[data-open-tab]");
    if (link) open(Number(link.dataset.openTab));
  });
  steps.forEach((step, i) => step.addEventListener("mouseenter", () => open(i)));
  initHeroScenes(show);
}
