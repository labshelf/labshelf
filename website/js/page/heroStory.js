// Holds what the hero's scenes share: the notes taken in the reader, the state of the note's plot, the caption of each scene and the moment a scene opens.

import { $, $$ } from "../dom.js";

export const PAGE_REF = "vaswani2017attention, p. 4";
export const DEFAULT_THOUGHT = "Why this scaling? Check the variance with random vectors.";

/** `notes` are the reader's notes in page order: `{ id, color, quote, text, hl, row, qmd }`, where `qmd` says the note also lands in the project's note. `scaled` is what the note's plot last ran with. */
export const story = { notes: [], scaled: true };

// The note the tour suggests, shown by the later scenes until the visitor adds one of their own.
const SUGGESTED = {
  id: "cue",
  color: "yellow",
  quote: 'divide each by <span class="rt">√<span><i>d</i><sub><i>k</i></sub></span></span>',
  text: DEFAULT_THOUGHT,
};

/** The notes the project's note and the manuscript draw on. */
export function projectNotes() {
  const own = story.notes.filter((note) => note.qmd);
  return own.length ? own : [SUGGESTED];
}

/** Sets the caption of scene `index`; `next` adds the button that opens the scene that follows. */
export function setGuide(index, html, next) {
  const button = next ? ` <button type="button" class="hero-next" data-open-tab="${next.tab}">${next.label}<span aria-hidden="true">→</span></button>` : "";
  $$("#show .hero-cap")[index].innerHTML = html + button;
}

/** Runs `run` each time scene `index` opens. */
export function onOpen(index, run) {
  $("#show").addEventListener("hero:open", (e) => { if (e.detail === index) run(); });
}

/** Closes what a scene has open on Escape or on a press outside `inside` (a selector). */
export function onDismiss(inside, close) {
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  document.addEventListener("pointerdown", (e) => { if (!(e.target instanceof Element) || !e.target.closest(inside)) close(); });
}
