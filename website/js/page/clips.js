// Plays the recorded clips only while they are on screen, and never under reduced motion.

import { $$, reducedMotion } from "../dom.js";

export function initClips() {
  const clips = $$("video.clip");
  if (reducedMotion) {
    for (const clip of clips) {
      clip.removeAttribute("autoplay");
      clip.pause();
    }
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      // TRAP: play() rejects when a pause interrupts it; that is expected while scrolling past.
      if (isIntersecting) target.play().catch(() => {});
      else target.pause();
    }
  });
  for (const clip of clips) observer.observe(clip);
}
