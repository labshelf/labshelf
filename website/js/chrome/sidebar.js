// The sidebar: three tabs, open/closed state and a drag-resizable width, persisted across visits like the reader does per paper.

import { byId, clamp, load, save } from "../dom.js";

const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
const KEY = "labshelf.site.sidebar";
const el = byId("sidebar");
const resizer = byId("sidebar-resizer");
const tabs = [...el.querySelectorAll(".rd-tab")];
const panels = [...el.querySelectorAll(".rd-panel")];
const showListeners = new Map();
const state = { open: window.innerWidth >= 1100, tab: "outline", width: 220, ...load(KEY, {}) };

export function isSidebarOpen() { return state.open; }

/** Run `fn` whenever `tab` becomes visible, so a panel can build itself lazily. */
export function onTabShow(tab, fn) {
  showListeners.set(tab, [...(showListeners.get(tab) ?? []), fn]);
}

function emitShow() {
  if (!state.open) return;
  for (const fn of showListeners.get(state.tab) ?? []) fn();
}

function render() {
  el.hidden = !state.open;
  resizer.hidden = !state.open;
  el.style.width = `${state.width}px`;
  for (const tab of tabs) tab.setAttribute("aria-selected", String(tab.dataset.tab === state.tab));
  for (const panel of panels) panel.hidden = panel.dataset.panel !== state.tab;
  byId("sidebar-toggle").setAttribute("aria-pressed", String(state.open));
}

function persist() {
  save(KEY, { open: state.open, tab: state.tab, width: state.width });
}

export function setSidebarOpen(open) {
  state.open = open;
  render();
  persist();
  emitShow();
}

export function toggleSidebar() {
  setSidebarOpen(!state.open);
}

export function selectTab(tab) {
  state.tab = tab;
  state.open = true;
  render();
  persist();
  emitShow();
}

function initResize() {
  resizer.addEventListener("pointerdown", (down) => {
    down.preventDefault();
    resizer.setPointerCapture(down.pointerId);
    const startX = down.clientX;
    const startWidth = state.width;
    document.documentElement.classList.add("rd-resizing");
    const move = (e) => {
      state.width = clamp(startWidth + e.clientX - startX, MIN_WIDTH, MAX_WIDTH);
      el.style.width = `${state.width}px`;
    };
    const up = () => {
      resizer.removeEventListener("pointermove", move);
      resizer.removeEventListener("pointerup", up);
      resizer.removeEventListener("pointercancel", up);
      document.documentElement.classList.remove("rd-resizing");
      persist();
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", up);
    resizer.addEventListener("pointercancel", up);
  });
}

export function initSidebar() {
  if (window.innerWidth < 760) state.open = false;
  state.width = clamp(state.width, MIN_WIDTH, MAX_WIDTH);
  for (const tab of tabs) tab.addEventListener("click", () => selectTab(tab.dataset.tab));
  byId("sidebar-toggle").addEventListener("click", toggleSidebar);
  initResize();
  render();
  emitShow();
}
