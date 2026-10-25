/**
 * Renders the theme picker: the five persisted presets plus session-only custom page colours.
 */
import { PDF_THEMES, type PdfTheme } from "../../../model/index.js";
import type { HostBridge } from "../session/index.js";
import { updatePopoverOpen } from "../elements/index.js";
import type { ThemeController } from "./theme.js";
import { renderElement } from "../../../ui/dom/index.js";

const THEME_LABELS: Record<PdfTheme, string> = {
  auto: "Auto",
  light: "Light",
  dark: "Dark",
  sepia: "Sepia",
  "high-contrast": "High contrast",
};

/**
 * A preset is persisted per paper by the host; custom colours apply to this session only.
 */
export function openThemePopover(anchor: HTMLElement, theme: ThemeController, host: HostBridge): void {
  const list = renderElement("div", { class: "rd-theme-list", role: "radiogroup", "aria-label": "Page theme" });
  for (const value of PDF_THEMES) {
    const btn = renderElement(
      "button",
      { class: "rd-theme-item", type: "button", role: "radio", "aria-checked": theme.preference === value ? "true" : "false" },
      renderElement("span", { class: `rd-theme-swatch rd-theme-swatch-${value}` }),
      THEME_LABELS[value],
    );
    btn.addEventListener("click", () => {
      // The host persists the choice and echoes `applyTheme` with the resolved effective theme.
      host.post({ command: "selectTheme", theme: value });
      for (const b of list.querySelectorAll("button")) { b.setAttribute("aria-checked", b === btn ? "true" : "false"); }
    });
    list.append(btn);
  }

  const { bg, text } = theme.colors;
  const bgInput = renderElement("input", { type: "color", value: bg, "aria-label": "Page background colour" });
  const textInput = renderElement("input", { type: "color", value: text, "aria-label": "Text colour" });
  const applyCustom = (): void => theme.applyPageColors(bgInput.value, textInput.value);
  bgInput.addEventListener("change", applyCustom);
  textInput.addEventListener("change", applyCustom);

  const content = renderElement(
    "div",
    { class: "rd-theme-popover" },
    list,
    renderElement("div", { class: "rd-menu-sep" }),
    renderElement("div", { class: "rd-theme-custom" },
      renderElement("span", { class: "rd-theme-custom-title" }, "Custom"),
      renderElement("label", {}, "Page", bgInput),
      renderElement("label", {}, "Text", textInput),
    ),
  );
  updatePopoverOpen(anchor, content, "below");
}
