// Page theme: the five presets, persisted and applied before first paint by the boot script in <head>, plus session-only custom page colours.

import { h, load, save } from "../dom.js";
import { togglePopover } from "./popover.js";

const KEY = "labshelf.site.theme";
const THEMES = ["auto", "light", "dark", "sepia", "high-contrast"];
const LABELS = { auto: "Auto", light: "Light", dark: "Dark", sepia: "Sepia", "high-contrast": "High contrast" };
const root = document.documentElement;
const dark = window.matchMedia("(prefers-color-scheme: dark)");
let preference = THEMES.includes(load(KEY, "auto")) ? load(KEY, "auto") : "auto";

function applyTheme() {
  root.dataset.theme = preference === "auto" ? (dark.matches ? "dark" : "light") : preference;
}

function pageColors() {
  const styles = getComputedStyle(root);
  return {
    bg: root.style.getPropertyValue("--page-bg") || styles.getPropertyValue("--canvas").trim(),
    text: root.style.getPropertyValue("--page-ink") || styles.getPropertyValue("--ink").trim(),
  };
}

function choose(value, list) {
  preference = value;
  save(KEY, value);
  root.style.removeProperty("--page-bg");
  root.style.removeProperty("--page-ink");
  applyTheme();
  for (const b of list.querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.theme === value));
}

export function openThemePopover(anchor) {
  const list = h("div", { class: "rd-theme-list", role: "radiogroup", "aria-label": "Page theme" });
  for (const value of THEMES) {
    const button = h("button", { class: "rd-menu-item", type: "button", role: "radio", "data-theme": value, "aria-checked": String(preference === value) },
      h("span", { class: `rd-theme-swatch rd-theme-swatch-${value}` }), LABELS[value]);
    button.addEventListener("click", () => choose(value, list));
    list.append(button);
  }
  const { bg, text } = pageColors();
  const bgInput = h("input", { type: "color", value: bg, "aria-label": "Page background colour" });
  const textInput = h("input", { type: "color", value: text, "aria-label": "Text colour" });
  const applyCustom = () => {
    root.style.setProperty("--page-bg", bgInput.value);
    root.style.setProperty("--page-ink", textInput.value);
  };
  bgInput.addEventListener("input", applyCustom);
  textInput.addEventListener("input", applyCustom);
  const content = h("div", {}, list, h("div", { class: "rd-menu-sep" }),
    h("div", { class: "rd-theme-custom" },
      h("span", { class: "rd-theme-custom-title" }, "Custom"),
      h("label", {}, "Page", bgInput),
      h("label", {}, "Text", textInput)));
  togglePopover(anchor, content, "below");
}

export function initTheme() {
  applyTheme();
  dark.addEventListener("change", applyTheme);
}
