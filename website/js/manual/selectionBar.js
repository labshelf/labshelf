// Highlights a text selection in the manual with the meaning picked from a floating bar, as the reader does.

import { $ } from "../dom.js";
import { toast } from "../toast.js";
import { renderHighlights } from "./highlightsList.js";

const bar = $("#selbar");
let range = null;

function showAbove(rect) {
  bar.hidden = false;
  bar.style.top = `${rect.top + scrollY - bar.offsetHeight - 8}px`;
  const centred = rect.left + scrollX + rect.width / 2 - bar.offsetWidth / 2;
  bar.style.left = `${Math.max(8, Math.min(centred, innerWidth - bar.offsetWidth - 8))}px`;
}

function highlight(meaning) {
  const mark = document.createElement("mark");
  mark.className = "h";
  mark.dataset.m = meaning;
  mark.title = meaning;
  try {
    range.surroundContents(mark);
    toast(`highlighted as ${meaning}`);
    renderHighlights();
  } catch {
    // TRAP: surroundContents throws when the selection crosses an element boundary, such as two paragraphs.
    toast("highlight within one paragraph");
  }
  getSelection().removeAllRanges();
  bar.hidden = true;
}

export function initSelectionBar() {
  // The selection is final only after mouseup has been handled.
  $("#doc").addEventListener("mouseup", () =>
    setTimeout(() => {
      const selection = getSelection();
      if (selection.isCollapsed || !selection.toString().trim()) {
        bar.hidden = true;
        return;
      }
      range = selection.getRangeAt(0).cloneRange();
      showAbove(range.getBoundingClientRect());
    }, 0),
  );
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest("#selbar")) bar.hidden = true;
  });
  // Keeps the selection alive while a meaning is clicked.
  bar.addEventListener("mousedown", (e) => e.preventDefault());
  bar.addEventListener("click", (e) => {
    const button = e.target.closest("[data-m]");
    if (button && range) highlight(button.dataset.m);
  });
}
