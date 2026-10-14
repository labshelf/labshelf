// The find bar: every match marked on the pages, stepping with Enter and Shift+Enter, match case and whole words, as in the reader.

import { byId, viewer, scrollToElement, pages } from "../dom.js";
import { textRange, wrapRange, unwrap, plainText } from "../document/textRanges.js";
import { jumpTo } from "../document/navigation.js";

const bar = byId("find-bar");
const input = byId("find-input");
const count = byId("find-count");
const matchCase = byId("find-case");
const wholeWord = byId("find-word");
const listeners = new Set();
let hits = [];
let current = -1;

export function isFindOpen() { return !bar.hidden; }
export function onFindToggle(fn) { listeners.add(fn); }

function clear() {
  for (const mark of document.querySelectorAll("mark.rd-find-hit")) unwrap(mark);
  hits = [];
  current = -1;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function search() {
  clear();
  const query = input.value;
  input.classList.remove("rd-find-notfound");
  if (!query) { count.textContent = ""; return; }
  const flags = matchCase.getAttribute("aria-pressed") === "true" ? "g" : "gi";
  const body = wholeWord.getAttribute("aria-pressed") === "true" ? `\\b${escapeRegExp(query)}\\b` : escapeRegExp(query);
  const re = new RegExp(body, flags);
  for (const page of pages()) {
    const text = plainText(page);
    const pageHits = [];
    // Wrapping from the end keeps earlier offsets valid while the text nodes split.
    for (const m of [...text.matchAll(re)].reverse()) {
      const range = textRange(page, m.index, m.index + m[0].length);
      if (range) pageHits.unshift(wrapRange(range, (mark) => { mark.className = "rd-find-hit"; }));
    }
    hits.push(...pageHits);
  }
  if (!hits.length) { count.textContent = "Not found"; input.classList.add("rd-find-notfound"); return; }
  select(0);
}

function select(index) {
  if (!hits.length) return;
  hits[current]?.forEach((m) => m.classList.remove("rd-current"));
  current = (index + hits.length) % hits.length;
  hits[current].forEach((m) => m.classList.add("rd-current"));
  count.textContent = `${current + 1} of ${hits.length}`;
  const target = hits[current][0];
  const far = Math.abs(target.closest(".page").offsetTop - viewer.scrollTop) > viewer.clientHeight * 2;
  if (far) jumpTo(target, true); else scrollToElement(target, true);
}

export function openFind() {
  const selection = window.getSelection()?.toString().trim();
  if (selection && selection.length < 80 && !selection.includes("\n")) input.value = selection;
  bar.hidden = false;
  byId("find-toggle").setAttribute("aria-pressed", "true");
  for (const fn of listeners) fn(true);
  input.focus();
  input.select();
  if (input.value) search();
}

export function closeFind() {
  bar.hidden = true;
  byId("find-toggle").setAttribute("aria-pressed", "false");
  clear();
  count.textContent = "";
  input.classList.remove("rd-find-notfound");
  for (const fn of listeners) fn(false);
  viewer.focus({ preventScroll: true });
}

export function toggleFind() {
  if (isFindOpen()) closeFind(); else openFind();
}

export function findNext() {
  if (!isFindOpen()) { openFind(); return; }
  if (!hits.length && input.value) search(); else select(current + 1);
}

export function findPrev() {
  if (!isFindOpen()) { openFind(); return; }
  select(current - 1);
}

export function initFind() {
  let timer = 0;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 120); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); if (e.shiftKey) findPrev(); else findNext(); }
    if (e.key === "Escape") { e.preventDefault(); closeFind(); }
  });
  for (const toggle of [matchCase, wholeWord]) {
    toggle.addEventListener("click", () => {
      toggle.setAttribute("aria-pressed", String(toggle.getAttribute("aria-pressed") !== "true"));
      search();
      input.focus();
    });
  }
  byId("find-next").addEventListener("click", findNext);
  byId("find-prev").addEventListener("click", findPrev);
  byId("find-close").addEventListener("click", closeFind);
}
