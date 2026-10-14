// The selection bubble: five highlight colours and Copy with citation, offered whenever text is selected on a page.

import { byId, h, viewer, toast, copyText, pageOf, isMac } from "../dom.js";
import { icon } from "../icons.js";
import { addHighlight } from "./highlights.js";
import { selectTab, isSidebarOpen } from "../chrome/sidebar.js";

const COLORS = ["yellow", "green", "blue", "red", "pink"];
const CITE_KEY = "nasser2026labshelf";
const bubble = byId("selection-toolbar");
let pending = null;

/** Pandoc style, the apps' default for `labshelf.reader.citationStyle`. */
function citation(text, page) {
  return `> ${text.replace(/\s+/g, " ").trim()}\n\n[@${CITE_KEY}, p. ${page}]`;
}

function place(range) {
  const rect = range.getBoundingClientRect();
  bubble.hidden = false;
  const w = bubble.offsetWidth;
  let top = rect.top - bubble.offsetHeight - 8;
  if (top < 46) top = rect.bottom + 8;
  bubble.style.top = `${top}px`;
  bubble.style.left = `${Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), window.innerWidth - w - 8)}px`;
}

export function hideBubble() {
  bubble.hidden = true;
  pending = null;
}

function offer() {
  setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!pageOf(range.commonAncestorContainer) || !range.toString().trim()) return;
    pending = range.cloneRange();
    place(range);
  }, 0);
}

export async function copyWithCitation() {
  const sel = window.getSelection();
  const range = pending ?? (sel?.rangeCount ? sel.getRangeAt(0) : null);
  const page = range && pageOf(range.commonAncestorContainer);
  if (!page || !range.toString().trim()) return;
  const ok = await copyText(citation(range.toString(), page.dataset.page));
  toast(ok ? "Copied with citation" : "Copy failed: use your browser's copy");
  hideBubble();
}

function highlight(color) {
  if (!pending) return;
  const added = addHighlight(pending, color);
  window.getSelection()?.removeAllRanges();
  hideBubble();
  if (added && (isSidebarOpen() || window.innerWidth >= 1100)) selectTab("annotations");
}

export function initSelection() {
  const mod = isMac ? "Cmd" : "Ctrl";
  bubble.append(
    ...COLORS.map((c) => h("button", { class: `rd-color-btn rd-color-${c}`, type: "button", title: `Highlight ${c}`, onclick: () => highlight(c) })),
    h("span", { class: "rd-bubble-sep" }),
    h("button", { class: "rd-btn rd-btn-sm", type: "button", title: `Copy with citation (${mod}+Shift+C)`, html: icon("quote"), onclick: copyWithCitation }),
  );
  bubble.addEventListener("mousedown", (e) => e.preventDefault());
  viewer.addEventListener("mouseup", offer);
  if (window.matchMedia("(pointer: coarse)").matches) {
    let settle = 0;
    document.addEventListener("selectionchange", () => { clearTimeout(settle); settle = setTimeout(offer, 350); });
  }
  viewer.addEventListener("scroll", hideBubble, { passive: true });
  document.addEventListener("mousedown", (e) => { if (!bubble.contains(e.target)) hideBubble(); });
}
