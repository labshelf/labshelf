// Opens the manual's Appearance popover from the Aa button: text size, width and page theme of the sheet, saved across visits.

import { $, escapeHtml } from "../dom.js";

const KEY = "labshelf.manual.appearance";
const SIZES = [["small", "A", "Small"], ["medium", "A", "Medium"], ["large", "A", "Large"]];
const WIDTHS = [["narrow", "Narrow", "Narrow"], ["wide", "Wide", "Wide"]];
const THEMES = [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"], ["sepia", "Sepia"], ["high-contrast", "High contrast"]];
const DEFAULTS = { theme: "auto", size: "medium", width: "wide" };
const CHOICES = { theme: THEMES.map(([v]) => v), size: SIZES.map(([v]) => v), width: WIDTHS.map(([v]) => v) };
const GAP = 6;

const man = $("#man");
const button = $("#aaBtn");
const pop = $("#aaPop");
const siteLight = matchMedia("(prefers-color-scheme: light)");
let state = { ...DEFAULTS };

/** @returns the saved appearance, each field falling back to its default when unknown or unreadable. */
function load() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    // TRAP: localStorage throws when storage is blocked, and the value may not be JSON.
  }
  const pick = (field) => (CHOICES[field].includes(saved[field]) ? saved[field] : DEFAULTS[field]);
  return { theme: pick("theme"), size: pick("size"), width: pick("width") };
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // The choice still applies for this visit.
  }
}

// The defaults are the sheet without attributes, so a page with nothing saved reads as before.
function apply() {
  for (const field of ["theme", "size", "width"]) {
    const value = state[field];
    if (value === DEFAULTS[field]) man.removeAttribute(`data-page-${field}`);
    else man.setAttribute(`data-page-${field}`, value);
  }
}

const radio = (field, value, label, content, extra = "") =>
  `<button type="button" role="radio" data-f="${field}" data-v="${value}" aria-checked="${state[field] === value}" aria-label="${escapeHtml(label)}" tabindex="${state[field] === value ? 0 : -1}"${extra}>${content}</button>`;

function render() {
  const sizes = SIZES.map(([v, text, label], k) => radio("size", v, label, text, ` style="font-size:${11 + k * 2}px"`)).join("");
  const widths = WIDTHS.map(([v, text, label]) => radio("width", v, label, text)).join("");
  const autoAs = siteLight.matches ? "light" : "dark";
  const tiles = THEMES.map(([v, label]) =>
    radio("theme", v, label, `<b>Aa</b>${escapeHtml(label)}`, ` data-page-theme="${v === "auto" ? autoAs : v}"`),
  ).join("");
  pop.innerHTML = `<div class="aarow"><span id="aaSize">Text size</span><span class="aaseg" role="radiogroup" aria-labelledby="aaSize">${sizes}</span></div>
<div class="aarow"><span id="aaWidth">Width</span><span class="aaseg" role="radiogroup" aria-labelledby="aaWidth">${widths}</span></div>
<hr><h3 id="aaThemes">Themes</h3><div class="aagrid" role="radiogroup" aria-labelledby="aaThemes">${tiles}</div>`;
}

function place() {
  const r = button.getBoundingClientRect();
  pop.style.top = `${r.bottom + GAP}px`;
  pop.style.left = `${Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8))}px`;
}

function open() {
  render();
  pop.hidden = false;
  button.setAttribute("aria-expanded", "true");
  place();
  pop.querySelector('[aria-checked="true"]')?.focus();
}

function close(refocus) {
  if (pop.hidden) return;
  pop.hidden = true;
  button.setAttribute("aria-expanded", "false");
  if (refocus) button.focus();
}

function choose(option) {
  state = { ...state, [option.dataset.f]: option.dataset.v };
  apply();
  save();
  render();
  pop.querySelector(`[data-f="${option.dataset.f}"][data-v="${option.dataset.v}"]`).focus();
}

// Arrow keys move the choice within a group, as radio groups do.
function onKey(e) {
  if (e.key === "Escape") {
    e.stopPropagation();
    close(true);
    return;
  }
  const option = e.target.closest("[role=radio]");
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!option || !step) return;
  e.preventDefault();
  const group = [...option.parentElement.querySelectorAll("[role=radio]")];
  choose(group[(group.indexOf(option) + step + group.length) % group.length]);
}

export function initAppearance() {
  state = load();
  apply();
  button.addEventListener("click", () => (pop.hidden ? open() : close(false)));
  pop.addEventListener("click", (e) => {
    const option = e.target.closest("[role=radio]");
    if (option) choose(option);
  });
  pop.addEventListener("keydown", onKey);
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest("#aaPop, #aaBtn")) close(false);
  });
  addEventListener("resize", () => pop.hidden || place());
  addEventListener("scroll", () => pop.hidden || place(), { passive: true });
  // The Auto tile shows what Auto resolves to, which follows the site theme.
  siteLight.addEventListener("change", () => pop.hidden || render());
}
