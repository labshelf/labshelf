// Filters the sidebar tree as the reader types: a row stays when its name or its section's text has every word typed, and Enter goes to the first one left.

import { $, $$ } from "../dom.js";
import { sectionSummary } from "../manual/sections.js";

/** The text a row is searched by: its name, plus the summary of a manual section or the copy of a landing section. */
function searchText(link) {
  const id = link.getAttribute("href").slice(1);
  const section = document.getElementById(id);
  const body = sectionSummary(id)?.text ?? (section?.matches(".sec") ? section.textContent : "");
  return `${link.textContent} ${body}`.toLowerCase().replace(/\s+/g, " ");
}

export function initSideSearch() {
  const input = $("#sideQ");
  const tree = $("#tree");
  if (!input || !tree) return;
  const none = $("#treeNone");
  const rows = $$("#tree a:not(.tree-h)").map((link) => ({ link, text: searchText(link) }));
  const chapters = $$("#tree details.ch");
  const headers = $$("#tree a.tree-h");
  // The chapters the reader had open, restored when the search is cleared.
  let opened = null;

  // The rows whose own text matches, in tree order; Enter goes to the first.
  let hits = [];

  function filter() {
    const words = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const searching = words.length > 0;
    if (searching && !opened) opened = chapters.filter((chapter) => chapter.open);
    tree.classList.toggle("searching", searching);
    hits = searching ? rows.filter(({ text }) => words.every((w) => text.includes(w))).map(({ link }) => link) : [];
    for (const { link } of rows) link.classList.toggle("miss", searching && !hits.includes(link));
    for (const chapter of chapters) {
      const head = chapter.querySelector("summary > a");
      const subsHit = [...chapter.querySelectorAll("a.sub")].some((sub) => hits.includes(sub));
      // A chapter whose subsections match stays, dimmed, as their heading.
      if (searching) chapter.open = subsHit;
      head.classList.toggle("miss", searching && !hits.includes(head) && !subsHit);
      chapter.classList.toggle("ctx", searching && !hits.includes(head) && subsHit);
    }
    // A group header shows while any row under it is left.
    for (const header of headers) {
      let any = false;
      for (let el = header.nextElementSibling; el && !el.matches(".tree-h, .tree-none"); el = el.nextElementSibling) {
        const row = el.matches("details") ? el.querySelector("summary > a") : el;
        if (!row.classList.contains("miss")) any = true;
      }
      header.classList.toggle("miss", searching && !any);
    }
    none.hidden = !searching || hits.length > 0;
    if (!searching && opened) {
      for (const chapter of chapters) chapter.open = opened.includes(chapter);
      opened = null;
    }
  }

  input.addEventListener("input", filter);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      filter();
      input.blur();
    } else if (e.key === "Enter") {
      if (!hits.length) return;
      e.preventDefault();
      location.hash = hits[0].getAttribute("href");
      input.value = "";
      filter();
      input.blur();
    }
  });
}

/** Whether the sidebar's search field is on screen, so Cmd/Ctrl K and / can go to it instead of the palette. */
export function sideSearchVisible() {
  const input = $("#sideQ");
  return Boolean(input?.checkVisibility?.({ visibilityProperty: true }) ?? input?.offsetParent);
}
