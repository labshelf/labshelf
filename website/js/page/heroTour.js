// Runs the hero's tour: a tab, or the underlined phrase that names it, opens one demo at a time; the browser recording plays only while it shows.

import { $, $$, reducedMotion } from "../dom.js";
import { hidePopover } from "../popover.js";

export function initHeroTour() {
  const show = $("#show");
  if (!show) return;
  const tabs = $$("#show [role=tab]");
  const slides = $$("#show .hero-slide");
  const captions = $$("#show .hero-cap");
  const phrases = $$(".pitch-link[data-tab]");

  // Under reduced motion the recording stays on its poster until the reader presses play.
  if (reducedMotion) for (const video of $$("#show .hero-slide video")) video.controls = true;

  function open(index) {
    hidePopover();
    tabs.forEach((tab, i) => tab.setAttribute("aria-selected", String(i === index)));
    captions.forEach((caption, i) => caption.classList.toggle("on", i === index));
    phrases.forEach((phrase) => phrase.classList.toggle("on", Number(phrase.dataset.tab) === index));
    slides.forEach((slide, i) => {
      slide.classList.toggle("on", i === index);
      const video = slide.querySelector("video");
      if (!video) return;
      if (i !== index) video.pause();
      else if (!reducedMotion) {
        video.currentTime = 0;
        // TRAP: play() rejects when a pause interrupts it; that is expected while switching tabs.
        video.play().catch(() => {});
      }
    });
  }

  tabs.forEach((tab, i) => tab.addEventListener("click", () => open(i)));
  for (const phrase of phrases) {
    const index = Number(phrase.dataset.tab);
    const openPhrase = () => {
      if (tabs[index].getAttribute("aria-selected") !== "true") open(index);
    };
    phrase.addEventListener("click", openPhrase);
    phrase.addEventListener("mouseenter", openPhrase);
  }
  open(0);
}
