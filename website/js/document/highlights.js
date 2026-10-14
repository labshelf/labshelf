// Highlights: the store persisted across visits, the marks painted on the pages, and the Annotations tab that lists, reveals, deletes and exports them.

import { byId, h, load, save, toast, copyText, pageOf, scrollToElement } from "../dom.js";
import { icon } from "../icons.js";
import { textRange, wrapRange, rangeOffsets, unwrap } from "./textRanges.js";

const KEY = "labshelf.site.highlights";
const TITLE = "LabShelf Guide";
let annotations = [];

function pageEl(n) {
  return document.querySelector(`#viewer > .page[data-page="${n}"]`);
}

function paint(a) {
  const range = textRange(pageEl(a.page), a.start, a.end);
  if (!range) return;
  wrapRange(range, (mark) => {
    mark.className = "hl";
    mark.dataset.color = a.color;
    mark.dataset.id = a.id;
  });
}

function renderTab() {
  const list = byId("annotations");
  list.replaceChildren();
  if (!annotations.length) {
    list.append(h("div", { class: "rd-empty" }, "No annotations yet. Select text on a page and pick a colour."));
    return;
  }
  const sorted = [...annotations].sort((a, b) => a.page - b.page || a.start - b.start);
  let page = 0;
  for (const a of sorted) {
    if (a.page !== page) {
      page = a.page;
      list.append(h("div", { class: "rd-ann-group" }, `Page ${page}`));
    }
    const text = a.text.length > 140 ? `${a.text.slice(0, 140)}…` : a.text;
    const del = h("button", { class: "rd-btn rd-btn-sm rd-ann-delete", type: "button", title: "Delete highlight", html: icon("trash") });
    del.addEventListener("click", (e) => { e.stopPropagation(); removeHighlight(a.id); });
    const item = h("div", { class: "rd-ann-item", tabindex: "0", "data-id": a.id },
      h("span", { class: `rd-ann-dot rd-color-${a.color}` }), h("span", { class: "rd-ann-text" }, text), del);
    item.addEventListener("click", () => revealHighlight(a.id));
    item.addEventListener("keydown", (e) => { if (e.key === "Enter") revealHighlight(a.id); });
    list.append(item);
  }
}

function persist() {
  save(KEY, annotations);
  renderTab();
}

export function addHighlight(range, color) {
  const page = pageOf(range.startContainer);
  if (!page || page !== pageOf(range.endContainer)) return null;
  const { start, end } = rangeOffsets(page, range);
  const a = { id: `h${Date.now().toString(36)}`, page: Number(page.dataset.page), start, end, color, text: range.toString().trim() };
  annotations.push(a);
  paint(a);
  persist();
  return a;
}

function removeHighlight(id) {
  for (const mark of document.querySelectorAll(`#viewer mark.hl[data-id="${id}"]`)) unwrap(mark);
  annotations = annotations.filter((a) => a.id !== id);
  persist();
}

function revealHighlight(id) {
  const marks = [...document.querySelectorAll(`#viewer mark.hl[data-id="${id}"]`)];
  if (!marks.length) return;
  scrollToElement(marks[0], true);
  for (const m of marks) m.classList.add("rd-flash");
  setTimeout(() => { for (const m of marks) m.classList.remove("rd-flash"); }, 900);
}

function annotationsMarkdown() {
  const sorted = [...annotations].sort((a, b) => a.page - b.page || a.start - b.start);
  return `# ${TITLE}\n\n${sorted.map((a) => `> ${a.text}\n\n(p. ${a.page})`).join("\n\n")}\n`;
}

/** Highlights written into the HTML as `<mark class="hl" data-seed>` are the first visit's annotations. */
function adoptSeeds() {
  const seeds = [...document.querySelectorAll("#viewer mark.hl[data-seed]")];
  return seeds.map((mark, i) => {
    const page = pageOf(mark);
    const range = document.createRange();
    range.selectNodeContents(mark);
    const { start, end } = rangeOffsets(page, range);
    mark.dataset.id = `seed${i}`;
    return { id: mark.dataset.id, page: Number(page.dataset.page), start, end, color: mark.dataset.color, text: mark.textContent.trim() };
  });
}

export function initHighlights() {
  const stored = load(KEY, null);
  if (stored) {
    for (const mark of document.querySelectorAll("#viewer mark.hl[data-seed]")) unwrap(mark);
    annotations = stored;
    annotations.forEach(paint);
  } else {
    annotations = adoptSeeds();
  }
  renderTab();
  byId("annotations-copy").addEventListener("click", async () => {
    if (!annotations.length) { toast("No annotations to copy"); return; }
    toast((await copyText(annotationsMarkdown())) ? "Annotations copied as Markdown" : "Copy failed");
  });
  byId("viewer").addEventListener("click", (e) => {
    const mark = e.target.closest("mark.hl");
    if (mark && window.getSelection()?.isCollapsed) revealHighlight(mark.dataset.id);
  });
}
