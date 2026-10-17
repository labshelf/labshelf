// Searches the manual's sections from a palette opened with Cmd/Ctrl K or /.

import { $, escapeHtml } from "../dom.js";
import { HEADINGS, sectionSummary } from "./sections.js";

const palette = $("#pal");
const input = $("#palIn");
const list = $("#palList");
const opener = $("#openPal");
const INDEX = HEADINGS.map((heading) => ({
  heading,
  text: `${heading.title} ${sectionSummary(heading.id)?.text ?? ""}`.toLowerCase(),
}));
let results = [];
let active = 0;

const chapterOf = (h) => HEADINGS.find((x) => !x.sub && x.number === h.number.split(".")[0])?.title ?? "";

function render() {
  const words = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  results = INDEX.filter((entry) => words.every((w) => entry.text.includes(w))).map((entry) => entry.heading);
  active = Math.min(active, Math.max(0, results.length - 1));
  list.innerHTML = results.length
    ? results
        .map(
          (h, k) =>
            `<li role="option" data-id="${h.id}" class="${k === active ? "on" : ""}" aria-selected="${k === active}"><span>§${h.number}</span>${escapeHtml(h.title)}<small>${escapeHtml(chapterOf(h))}</small></li>`,
        )
        .join("")
    : '<li class="empty">nothing appropriate. try “cite”, “bib” or “limit”.</li>';
}

function open() {
  palette.hidden = false;
  input.value = "";
  active = 0;
  render();
  input.focus();
}

function close() {
  if (palette.hidden) return;
  palette.hidden = true;
  opener.focus();
}

function go(id) {
  close();
  document.getElementById(id).scrollIntoView({ block: "start" });
}

function onKey(e) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    active = Math.max(0, Math.min(active + (e.key === "ArrowDown" ? 1 : -1), results.length - 1));
    render();
  } else if (e.key === "Enter" && results[active]) {
    // TRAP: close() focuses the opener, and an Enter left unhandled would click it and reopen the palette.
    e.preventDefault();
    go(results[active].id);
  }
}

export function initSearch() {
  if (!/Mac|iPhone|iPad/.test(navigator.platform)) $("#kk").textContent = "Ctrl K";
  opener.addEventListener("click", open);
  input.addEventListener("input", () => {
    active = 0;
    render();
  });
  input.addEventListener("keydown", onKey);
  list.addEventListener("click", (e) => {
    const item = e.target.closest("li[data-id]");
    if (item) go(item.dataset.id);
  });
  palette.addEventListener("mousedown", (e) => {
    if (e.target === palette) close();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      palette.hidden ? open() : close();
    } else if (e.key === "/" && palette.hidden && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault();
      open();
    } else if (e.key === "Escape") close();
  });
}
