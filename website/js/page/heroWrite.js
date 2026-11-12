// Runs the hero's manuscript: the visitor cites one of the reader's highlights, inserts the note's equation, and the preview recompiles; pointing at the citation or the equation shows where it comes from.

import { $, $$, reducedMotion } from "../dom.js";
import { onDismiss, onOpen, projectNotes, setGuide, story } from "./heroStory.js";

const COMPILE_MS = 600;
const LEAVE_MS = 250;
const NOTE_CHARS = 44;

export function initWrite() {
  const slide = $("#show .s-write");
  const source = $("#wrSrc");
  const suggest = $("#wrSuggest");
  const cite = $("#wrCite");
  const cards = $$("#wrSrc .hov");
  // Where each card opens: under the citation's key, and at the comment that links the equation to its note.
  const anchors = { cite: $("#wrSrc .key"), eq: $("#wrSrc .lsc") };
  let offered = [];
  let dismissed = false;
  let leaving = 0;

  function openSuggest() {
    offered = [...projectNotes(), ...story.notes.filter((note) => !note.qmd)];
    suggest.innerHTML = `<p class="sg-h">vaswani2017attention · your highlights</p>${offered.map((note, i) => `<button type="button" role="option" data-i="${i}" data-m="${note.color}"><i class="acc"></i><span class="q">“${note.quote}”</span><small></small></button>`).join("")}`;
    suggest.querySelectorAll("small").forEach((el, i) => { el.textContent = `p. 4 · ${offered[i].text || "no note"}`; });
    suggest.hidden = false;
    cite.classList.remove("hint");
    const box = source.getBoundingClientRect();
    const at = cite.getBoundingClientRect();
    suggest.style.top = `${at.bottom - box.top + 4}px`;
    suggest.style.left = `${Math.max(8, Math.min(at.left - box.left, box.width - suggest.offsetWidth - 8))}px`;
  }

  function closeSuggest() {
    if (suggest.hidden) return;
    suggest.hidden = true;
    dismissed = true;
    cite.classList.add("hint");
  }

  /** Shows the source's new state at once and the preview's after a build. */
  function build(sourceState, previewState, stats) {
    slide.classList.add(sourceState);
    $("#wrFoot").classList.add("busy");
    $("#wrBuild").textContent = "Compiling…";
    setTimeout(() => {
      slide.classList.add(previewState);
      $("#wrFoot").classList.remove("busy");
      $("#wrBuild").textContent = "Compiled just now";
      $("#wrStats").textContent = stats;
    }, reducedMotion ? 0 : COMPILE_MS);
  }

  suggest.addEventListener("click", (e) => {
    const option = e.target.closest("[data-i]");
    if (!option) return;
    const note = offered[Number(option.dataset.i)];
    const text = note.text.length > NOTE_CHARS ? `${note.text.slice(0, NOTE_CHARS)}…` : note.text;
    $("#wrQuote").innerHTML = `“${note.quote}”`;
    $("#wrNote").textContent = note.text ? `Your note · ${note.text}` : "Your highlight";
    $("#wrLens").textContent = note.text ? `1 note on p. 4 · ${text}` : "1 highlight on p. 4";
    $("#wrOpen").dataset.note = note.id;
    cards[0].dataset.m = note.color;
    suggest.hidden = true;
    build("c1", "p1", "1 cite · 10 words");
    setGuide(3, "Now <b>insert the equation</b> from the note.");
  });
  cite.addEventListener("click", () => (suggest.hidden ? openSuggest() : closeSuggest()));
  $("#wrEq").addEventListener("click", () => {
    build("c2", "p2", "1 cite · 24 words");
    setGuide(3, "Point at the citation or the equation.");
  });

  function showCard(name) {
    clearTimeout(leaving);
    for (const el of slide.querySelectorAll("[data-pick]")) el.classList.toggle("on", el.dataset.pick === name);
    const card = cards.find((other) => other.dataset.pick === name);
    if (!card) return;
    const box = source.getBoundingClientRect();
    const at = anchors[name].getBoundingClientRect();
    const under = at.bottom - box.top + 6;
    card.style.top = `${under + card.offsetHeight > box.height - 4 ? Math.max(4, at.top - box.top - card.offsetHeight - 6) : under}px`;
  }

  const hideCards = () => showCard("");
  slide.addEventListener("mouseover", (e) => {
    const el = e.target.closest("[data-pick]");
    if (el) showCard(el.dataset.pick);
  });
  slide.addEventListener("mouseout", (e) => {
    if (!e.target.closest("[data-pick]") || e.relatedTarget?.closest?.("[data-pick]")) return;
    clearTimeout(leaving);
    leaving = setTimeout(hideCards, LEAVE_MS);
  });
  slide.addEventListener("focusin", (e) => { if (e.target.matches("[data-pick]")) showCard(e.target.dataset.pick); });
  slide.addEventListener("click", (e) => {
    const el = e.target.closest("[data-pick]");
    if (el) showCard(el.dataset.pick);
  });
  // Marks in the text are spans, so they take Enter and Space themselves.
  slide.addEventListener("keydown", (e) => {
    if ((e.key !== "Enter" && e.key !== " ") || !e.target.matches("span[data-pick]")) return;
    e.preventDefault();
    showCard(e.target.dataset.pick);
  });
  onDismiss(".s-write [data-pick]", hideCards);
  onDismiss("#wrSuggest, #wrCite", closeSuggest);

  // The list of highlights opens with the scene until the visitor closes it once.
  onOpen(3, () => { if (!slide.classList.contains("c1") && !dismissed) openSuggest(); });
}
