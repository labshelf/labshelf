// The `?` sheet: every active shortcut, generated from the keymap, plus a vim-keys toggle that stands in for the apps' setting.

import { byId, h, isMac } from "../dom.js";
import { icon } from "../icons.js";
import { cheatsheetRows } from "./keymap.js";

const el = byId("cheatsheet");
let vimState = { get: () => false, set: () => {} };

/** The keys module owns the vim preference; it registers its accessors here to avoid a circular import at load. */
export function bindVimKeys(get, set) {
  vimState = { get, set };
}

export function isCheatsheetOpen() { return !el.hidden; }

export function closeCheatsheet() {
  el.hidden = true;
  el.replaceChildren();
}

function render() {
  const rows = cheatsheetRows({ vimKeys: vimState.get(), isMac });
  const grid = h("div", { class: "rd-cheat-grid" });
  let group = "";
  let column = null;
  for (const row of rows) {
    if (row.group !== group || !column) {
      group = row.group;
      column = h("div", { class: "rd-cheat-col" }, h("div", { class: "rd-cheat-group" }, group));
      grid.append(column);
    }
    const keys = h("span", { class: "rd-cheat-keys" });
    row.keys.forEach((k, i) => { if (i > 0) keys.append(" "); keys.append(h("kbd", {}, k)); });
    column.append(h("div", { class: "rd-cheat-row" }, h("span", {}, row.label), keys));
  }
  const toggle = h("input", { type: "checkbox", id: "vim-keys" });
  toggle.checked = vimState.get();
  toggle.addEventListener("change", () => { vimState.set(toggle.checked); render(); });
  const close = h("button", { class: "rd-btn rd-btn-sm", type: "button", title: "Close (Esc)", html: icon("x"), onclick: closeCheatsheet });
  const card = h("div", { class: "rd-cheat-card", role: "dialog", "aria-modal": "true", "aria-label": "Keyboard shortcuts" },
    h("div", { class: "rd-cheat-title" }, "Keyboard shortcuts", close),
    grid,
    h("label", { class: "rd-cheat-note", for: "vim-keys" }, toggle,
      "Vim keys: single-key navigation (j/k, gg/G, /, n/N, H/L). In the apps this is the setting labshelf.reader.vimKeys."));
  el.replaceChildren(card);
}

function openCheatsheet() {
  render();
  el.hidden = false;
  el.querySelector(".rd-cheat-card")?.focus?.();
}

export function toggleCheatsheet() {
  if (isCheatsheetOpen()) closeCheatsheet(); else openCheatsheet();
}

el.addEventListener("mousedown", (e) => { if (e.target === el) closeCheatsheet(); });
