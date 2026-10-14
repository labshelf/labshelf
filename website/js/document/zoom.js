// Zoom: the reader's presets (fit width, fit page, actual size, automatic) and percentages, applied through the --zoom custom property.

import { viewer, clamp, load, save, pages } from "../dom.js";
import { currentPage } from "./navigation.js";

const PAGE_W = 816;
const PAGE_H = PAGE_W * 297 / 210;
const MIN = 0.25;
const MAX = 4;
const DELTA = 1.1;
const MAX_AUTO = 1.25;
const KEY = "labshelf.site.zoom";
const PRESETS = ["page-width", "page-fit", "page-actual", "auto"];
const listeners = new Set();
let scaleValue = load(KEY, "auto");
let scale = 1;

function pageWidthScale() { return Math.max(MIN, (viewer.clientWidth - 24) / PAGE_W); }
function pageFitScale() { return Math.max(MIN, Math.min(pageWidthScale(), (viewer.clientHeight - 38 - 28) / PAGE_H)); }

function resolve(value) {
  switch (value) {
    case "page-width": return pageWidthScale();
    case "page-fit": return pageFitScale();
    case "page-actual": return 1;
    case "auto": return Math.min(pageWidthScale(), MAX_AUTO);
    default: return clamp(Number(value) || 1, MIN, MAX);
  }
}

/** Re-apply the scale, keeping the page in view at the same relative position. */
function apply() {
  const page = pages()[currentPage() - 1];
  const relative = page ? (viewer.scrollTop - page.offsetTop) / page.offsetHeight : 0;
  scale = resolve(scaleValue);
  document.documentElement.style.setProperty("--zoom", String(scale));
  if (page) viewer.scrollTop = page.offsetTop + relative * page.offsetHeight;
  for (const fn of listeners) fn(scale, scaleValue);
}

function set(value) {
  scaleValue = value;
  save(KEY, value);
  apply();
}

export function formatZoomLabel(value) {
  return `${Math.round(value * 100)}%`;
}

export function onZoomChange(fn) {
  listeners.add(fn);
  fn(scale, scaleValue);
}

export const zoom = {
  get scale() { return scale; },
  get scaleValue() { return scaleValue; },
  setPreset(preset) { set(preset); },
  setScale(n) { set(String(clamp(n, MIN, MAX))); },
  zoomIn() { set(String(clamp(scale * DELTA, MIN, MAX))); },
  zoomOut() { set(String(clamp(scale / DELTA, MIN, MAX))); },
  reset() { set("auto"); },
};

export function initZoom() {
  if (!PRESETS.includes(scaleValue) && !(Number(scaleValue) > 0)) scaleValue = "auto";
  apply();
  let width = viewer.clientWidth;
  new ResizeObserver(() => {
    if (viewer.clientWidth === width) return;
    width = viewer.clientWidth;
    if (PRESETS.includes(scaleValue)) apply();
  }).observe(viewer);
}
