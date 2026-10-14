// The status pill: an editable page number, zoom in and out, and the zoom menu with the reader's presets.

import { byId, h, pages, viewer } from "../dom.js";
import { icon } from "../icons.js";
import { buildMenu, togglePopover } from "./popover.js";
import { zoom, formatZoomLabel, onZoomChange } from "../document/zoom.js";
import { currentPage, goToPage, onPageChange } from "../document/navigation.js";

const PERCENT_CHOICES = [50, 75, 100, 125, 150, 200, 300, 400];
const PRESETS = [["page-width", "Fit width"], ["page-fit", "Fit page"], ["page-actual", "Actual size"], ["auto", "Automatic"]];
let pageInput;
let zoomButton;

function iconButton(name, title, run) {
  return h("button", { class: "rd-btn rd-btn-sm", type: "button", title, html: icon(name), onclick: run });
}

function commitPage() {
  const n = Number.parseInt(pageInput.value, 10);
  if (Number.isInteger(n) && n >= 1 && n <= pages().length) goToPage(n);
  else pageInput.value = String(currentPage());
}

function openZoomMenu() {
  const value = zoom.scaleValue;
  const items = PRESETS.map(([preset, label]) => ({ label, checked: value === preset, run: () => zoom.setPreset(preset) }));
  const custom = !PRESETS.some(([preset]) => preset === value);
  items.push(...PERCENT_CHOICES.map((p, i) => ({
    label: `${p}%`,
    separatorBefore: i === 0,
    checked: custom && Math.round(zoom.scale * 100) === p,
    run: () => zoom.setScale(p / 100),
  })));
  togglePopover(zoomButton, buildMenu(items), "above");
}

export function focusPageInput() {
  pageInput.focus();
  pageInput.select();
}

export function initStatusPill() {
  pageInput = h("input", { class: "rd-page-input", type: "text", inputmode: "numeric", "aria-label": "Go to page", title: "Go to page", value: "1" });
  zoomButton = h("button", { class: "rd-zoom-label", type: "button", title: "Zoom options", "aria-haspopup": "menu", onclick: openZoomMenu });
  pageInput.addEventListener("focus", () => pageInput.select());
  pageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { commitPage(); pageInput.blur(); viewer.focus({ preventScroll: true }); }
    if (e.key === "Escape") { pageInput.value = String(currentPage()); pageInput.blur(); viewer.focus({ preventScroll: true }); }
  });
  pageInput.addEventListener("blur", () => { pageInput.value = String(currentPage()); });
  byId("status-pill").append(
    h("div", { class: "rd-pill-group" }, pageInput, h("span", { class: "rd-page-total" }, `/ ${pages().length}`)),
    h("div", { class: "rd-pill-sep" }),
    h("div", { class: "rd-pill-group rd-pill-zoom" },
      iconButton("minus", "Zoom out", () => zoom.zoomOut()), zoomButton, iconButton("plus", "Zoom in", () => zoom.zoomIn())),
  );
  onPageChange((page) => { if (document.activeElement !== pageInput) pageInput.value = String(page); });
  onZoomChange((scale) => { zoomButton.textContent = formatZoomLabel(scale); });
}
