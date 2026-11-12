// Collapses the site sidebar and brings it back, from the top bar's button or Cmd/Ctrl B as in the editor, and remembers the choice.

import { $ } from "../dom.js";

const KEY = "labshelf.side";

export function initSideToggle() {
  const button = $("#sideToggle");
  if (!button) return;
  const root = document.documentElement;
  const sync = () => {
    const open = !root.classList.contains("side-off");
    button.setAttribute("aria-expanded", String(open));
    if (!navigator.platform.includes("Mac")) button.title = "Toggle sidebar (Ctrl+B)";
  };
  const toggle = () => {
    const off = root.classList.toggle("side-off");
    try { localStorage.setItem(KEY, off ? "off" : "on"); } catch { /* private mode: the choice lasts for this visit */ }
    sync();
  };
  button.addEventListener("click", toggle);
  addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "b") return;
    // Typing keeps its own Cmd/Ctrl B.
    if (e.target.closest?.("input, textarea, [contenteditable=''], [contenteditable='true']")) return;
    e.preventDefault();
    toggle();
  });
  sync();
}
