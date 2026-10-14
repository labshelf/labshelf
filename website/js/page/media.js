// Figure videos play only while on screen, and wait for a click when the visitor prefers reduced motion.

export function initMedia() {
  const videos = [...document.querySelectorAll("#viewer video")];
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (const v of videos) { v.autoplay = false; v.pause(); v.controls = true; }
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (isIntersecting) target.play().catch(() => { target.controls = true; });
      else target.pause();
    }
  }, { threshold: 0.25 });
  for (const v of videos) { v.autoplay = false; v.pause(); observer.observe(v); }
}
