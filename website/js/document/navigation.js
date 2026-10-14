// Moving through the document: the page in view, link clicks, back/forward history and the URL hash that follows the section in view.

import { byId, viewer, pages, offsetInViewer, scrollToElement } from "../dom.js";

const back = [];
const forward = [];
const pageListeners = new Set();
const historyListeners = new Set();
let lastPage = 0;

export function onPageChange(fn) { pageListeners.add(fn); }
export function onHistoryChange(fn) { historyListeners.add(fn); }

/** The page the reader is "on": the last page whose top is above the upper third of the viewer. */
export function currentPage() {
  const all = pages();
  if (viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 2) return all.length;
  const probe = viewer.scrollTop + viewer.clientHeight / 3;
  let current = 1;
  for (const page of all) {
    if (page.offsetTop <= probe) current = Number(page.dataset.page);
  }
  return current;
}

function emitHistory() {
  for (const fn of historyListeners) fn(back.length > 0, forward.length > 0);
}

/** Jump to an element, remembering where the reader was so Back returns there. */
export function jumpTo(el, center = false) {
  back.push(viewer.scrollTop);
  forward.length = 0;
  emitHistory();
  scrollToElement(el, center);
}

export function goBack() {
  if (!back.length) return;
  forward.push(viewer.scrollTop);
  viewer.scrollTo({ top: back.pop() });
  emitHistory();
}

export function goForward() {
  if (!forward.length) return;
  back.push(viewer.scrollTop);
  viewer.scrollTo({ top: forward.pop() });
  emitHistory();
}

export function goToPage(n) {
  const all = pages();
  const page = all[Math.min(Math.max(n, 1), all.length) - 1];
  if (page) jumpTo(page);
}

export function scrollViewer(dy, dx = 0) {
  viewer.scrollBy({ top: dy, left: dx });
}

/** The heading whose section holds the upper third of the viewer, for the hash and the outline. */
export function currentSection() {
  const probe = viewer.scrollTop + viewer.clientHeight / 3;
  let current = null;
  for (const heading of document.querySelectorAll("#viewer [data-outline]")) {
    if (offsetInViewer(heading) - 24 <= probe) current = heading;
  }
  return current;
}

function report() {
  const page = currentPage();
  if (page !== lastPage) {
    lastPage = page;
    for (const fn of pageListeners) fn(page);
  }
  const section = currentSection();
  // The cover is the document itself: at the top the URL carries no hash.
  const hash = section && section.id !== "cover" ? `#${section.id}` : "";
  if (hash !== location.hash) history.replaceState(null, "", hash || location.pathname);
}

export function initNavigation() {
  let ticking = false;
  viewer.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; report(); });
  }, { passive: true });
  byId("nav-back").addEventListener("click", goBack);
  byId("nav-forward").addEventListener("click", goForward);
  onHistoryChange((canBack, canForward) => {
    byId("nav-back").disabled = !canBack;
    byId("nav-forward").disabled = !canForward;
  });
  byId("viewer").addEventListener("click", (e) => {
    const link = e.target.closest('a[href^="#"]');
    const target = link && document.getElementById(link.hash.slice(1));
    if (!target) return;
    e.preventDefault();
    jumpTo(target);
  });
  const initial = location.hash && document.getElementById(location.hash.slice(1));
  if (initial) scrollToElement(initial);
  report();
}
