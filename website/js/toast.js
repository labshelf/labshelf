// Shows a short status message at the bottom of the page.

import { $ } from "./dom.js";

let hideTimer;

export function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => el.classList.remove("show"), 1800);
}
