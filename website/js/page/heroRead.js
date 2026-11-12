// Runs the hero's reader: any passage of the page can be selected, highlighted in a colour or added to a note; a note opens in a floating editor on the page and is listed in the Notes tab.

import { $, reducedMotion } from "../dom.js";
import { DEFAULT_THOUGHT, onOpen, setGuide, story } from "./heroStory.js";

const TYPE_MS = 22;
const SAVE_MS = 500;
const SELECT_MS = 300;
const canHover = matchMedia("(hover:hover)").matches;

export function initRead(show) {
  const page = $("#rdPage");
  const paper = $("#rdPaper");
  const bubble = $("#rdBubble");
  const menu = $("#rdMenu");
  const float = $("#rdFloat");
  const body = $("#rdFloatBody");
  const status = $("#rdFloatStatus");
  const list = $("#rdNotes");
  const cue = $("#rdCue");
  // What the bubble acts on: a range of the page, or a passage that is already marked.
  let pending = null;
  let open = null;
  let dragging = false;
  let typing = 0;
  let saving = 0;
  let selecting = 0;
  let serial = 0;

  /** Puts `el` above the start of `target`, or under its end when `below`, inside the page. */
  function place(el, target, below) {
    const box = paper.getBoundingClientRect();
    const rects = [...target.getClientRects()].filter((rect) => rect.width > 0);
    if (!rects.length) return;
    const first = rects[0];
    const last = rects.at(-1);
    let top = first.top - box.top - el.offsetHeight - 10;
    if (below || top < 4) top = last.bottom - box.top + 8;
    el.style.left = `${Math.min(Math.max(first.left - box.left - 20, 6), box.width - el.offsetWidth - 6)}px`;
    el.style.top = `${top}px`;
  }

  /** Scrolls the page until `el` is inside it. */
  function reveal(el) {
    const box = page.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const over = rect.bottom - box.bottom + 12;
    const under = rect.top - box.top - 12;
    if (over > 0 || under < 0) page.scrollBy({ top: under < 0 ? under : over, behavior: reducedMotion ? "auto" : "smooth" });
  }

  function showBubble(target) {
    if (target !== cue) dropCue();
    pending = target;
    menu.hidden = true;
    bubble.hidden = false;
    place(bubble, target);
  }

  function hideBubble() {
    bubble.hidden = true;
    menu.hidden = true;
    pending = null;
    dropCue();
  }

  /** The suggested passage loses its selection and keeps a dashed line, so a click selects it again. */
  function dropCue() {
    if (cue.classList.contains("sel")) cue.classList.replace("sel", "cue");
  }

  /** Turns what the bubble acts on into a highlight of `color` and returns it. */
  function mark(color) {
    let span = pending;
    if (!(span instanceof Element)) {
      span = document.createElement("span");
      span.append(pending.extractContents());
      pending.insertNode(span);
      // A selection that crossed the suggested passage carries a copy of part of it.
      for (const part of span.querySelectorAll(".cue, .sel")) part.removeAttribute("class");
      getSelection().removeAllRanges();
    }
    span.className = "hl";
    span.dataset.m = color;
    bubble.hidden = true;
    menu.hidden = true;
    pending = null;
    return span;
  }

  function quoteOf(span) {
    const copy = span.cloneNode(true);
    for (const el of copy.querySelectorAll("[data-m], [id]")) for (const name of ["class", "id", "data-m", "data-note", "role", "tabindex"]) el.removeAttribute(name);
    return copy.innerHTML;
  }

  function rowOf(note) {
    const row = document.createElement("div");
    row.className = "rd-note new";
    row.dataset.note = note.id;
    row.dataset.m = note.color;
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.innerHTML = '<i class="acc"></i><p class="q"></p><p class="t"></p>';
    row.children[1].innerHTML = note.quote;
    return row;
  }

  /** Shows the note's text in its row of the Notes tab. */
  function sync(note) {
    const text = note.row.querySelector(".t");
    text.textContent = note.text || "Empty note";
    text.classList.toggle("ph", !note.text);
  }

  /** Adds a note on the highlight `span`, in page order. */
  function addNote(span) {
    const note = { id: `n${++serial}`, color: span.dataset.m, quote: quoteOf(span), text: "", hl: span, qmd: true };
    span.dataset.note = note.id;
    span.setAttribute("role", "button");
    span.tabIndex = 0;
    note.row = rowOf(note);
    const next = story.notes.find((other) => span.compareDocumentPosition(other.hl) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (next) next.row.before(note.row);
    else list.append(note.row);
    story.notes.splice(next ? story.notes.indexOf(next) : story.notes.length, 0, note);
    $("#rdCount").textContent = String(story.notes.length);
    sync(note);
    return note;
  }

  function stopTyping() {
    clearInterval(typing);
    typing = 0;
  }

  /** Writes `text` into the open note a letter at a time; the visitor's first key takes over. */
  function typeOut(note, text) {
    let shown = reducedMotion ? text.length - 1 : 0;
    typing = setInterval(() => {
      body.value = note.text = text.slice(0, ++shown);
      sync(note);
      if (shown >= text.length) stopTyping();
    }, TYPE_MS);
  }

  function openNote(note, focus = true) {
    closeNote();
    open = note;
    for (const other of story.notes) for (const el of [other.row, other.hl]) el.classList.toggle("on", other === note);
    float.dataset.m = note.color;
    float.querySelector(".q").innerHTML = note.quote;
    body.value = note.text;
    status.textContent = "Saved";
    $("#rdFloatFull").hidden = !note.qmd;
    float.hidden = false;
    place(float, note.hl, true);
    reveal(float);
    if (focus && canHover) body.focus({ preventScroll: true });
  }

  function closeNote() {
    stopTyping();
    if (!open) return;
    for (const el of [open.row, open.hl]) el.classList.remove("on");
    float.hidden = true;
    open = null;
  }

  /** Offers the bubble for the text the visitor selected, kept to one paragraph of the page. */
  function readSelection() {
    const selection = getSelection();
    if (!selection.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0).cloneRange();
    const start = blockOf(range.startContainer);
    if (!start) return;
    if (blockOf(range.endContainer) !== start) range.setEnd(start, start.childNodes.length);
    if (range.toString().trim().length > 1) showBubble(range);
  }

  function blockOf(node) {
    const block = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest("p, h4");
    return block && block.parentElement === paper && !block.matches(".eq, .pgn") ? block : null;
  }

  /** Opens the note `id` names; the suggested one, not added yet, is selected again instead. */
  function openById(id) {
    const note = story.notes.find((other) => other.id === id);
    if (note) openNote(note, false);
    else if (id === "cue" && cue.matches(".cue, .sel")) {
      cue.className = "sel";
      showBubble(cue);
    }
  }

  // Pressing the bubble keeps the page's selection.
  bubble.addEventListener("pointerdown", (e) => e.preventDefault());
  bubble.addEventListener("click", (e) => {
    if (!pending) return;
    const dot = e.target.closest("[data-color]");
    if (dot) return void mark(dot.dataset.color);
    if (e.target.closest("#rdAdd")) {
      const suggested = pending === cue;
      const span = mark(pending instanceof Element && pending.dataset.m ? pending.dataset.m : "yellow");
      const note = addNote(span);
      openNote(note);
      if (suggested) typeOut(note, DEFAULT_THOUGHT);
      $("#rdAdd").classList.remove("hint");
      setGuide(0, "Write your thought.", { tab: 1, label: "Open the note" });
      return;
    }
    if (e.target.closest("#rdCite")) return void (menu.hidden = !menu.hidden);
    if (e.target.closest("#rdCopy")) navigator.clipboard?.writeText(`“${pending.textContent ?? pending.toString()}” (Vaswani et al., 2017, p. 4)`).catch(() => {});
    if (e.target.closest(".rd-menu button")) hideBubble();
  });

  paper.addEventListener("click", (e) => {
    if (e.target.closest("#rdBubble, #rdFloat") || !getSelection().isCollapsed) return;
    const span = e.target.closest(".hl, .cue");
    if (!span) return;
    const note = story.notes.find((other) => other.hl === span);
    if (note) return openNote(note);
    if (span === cue && cue.classList.contains("cue")) cue.className = "sel";
    showBubble(span);
  });
  list.addEventListener("click", (e) => {
    const row = e.target.closest(".rd-note");
    if (row) openById(row.dataset.note);
  });
  // Rows and highlights are not buttons, so they take Enter and Space themselves.
  $(".s-read").addEventListener("keydown", (e) => {
    if ((e.key !== "Enter" && e.key !== " ") || !e.target.matches(".rd-note, .hl, .cue")) return;
    e.preventDefault();
    e.target.click();
  });

  body.addEventListener("keydown", stopTyping);
  body.addEventListener("input", () => {
    if (!open) return;
    open.text = body.value.trim();
    sync(open);
    status.textContent = "Saving…";
    clearTimeout(saving);
    saving = setTimeout(() => { status.textContent = "Saved"; }, SAVE_MS);
  });
  $("#rdFloatClose").addEventListener("click", closeNote);
  $("#rdFloatSrc").addEventListener("click", () => { if (open) reveal(open.hl); });

  document.addEventListener("pointerdown", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!bubble.hidden && !target?.closest("#rdBubble")) hideBubble();
    if (open && !target?.closest("#rdFloat, .rd-note, .hl[data-note]")) closeNote();
    dragging = Boolean(target?.closest("#rdPaper")) && !target.closest("#rdBubble, #rdFloat");
  });
  document.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    setTimeout(readSelection);
  });
  // A selection made without the pointer, as on a touch screen, settles before the bubble opens.
  document.addEventListener("selectionchange", () => {
    if (dragging) return;
    clearTimeout(selecting);
    selecting = setTimeout(readSelection, SELECT_MS);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!menu.hidden) menu.hidden = true;
    else if (!bubble.hidden) {
      hideBubble();
      if (paper.contains(getSelection().anchorNode)) getSelection().removeAllRanges();
    } else closeNote();
  });

  // A link to a note in another scene opens that note once the reader is on screen.
  show.addEventListener("click", (e) => {
    const link = e.target.closest('[data-open-tab="0"][data-note]');
    if (link) requestAnimationFrame(() => openById(link.dataset.note));
  });

  const replace = () => {
    if (pending) place(bubble, pending);
    if (open) place(float, open.hl, true);
  };
  new ResizeObserver(replace).observe(paper);
  onOpen(0, replace);

  // The note the paper already has.
  const seedRow = list.querySelector(".rd-note");
  const seedMark = paper.querySelector(`.hl[data-note="${seedRow.dataset.note}"]`);
  story.notes.push({ id: seedRow.dataset.note, color: "green", quote: quoteOf(seedMark), text: seedRow.querySelector(".t").textContent, hl: seedMark, row: seedRow, qmd: false });

  showBubble(cue);
  document.fonts?.ready.then(replace);
}
