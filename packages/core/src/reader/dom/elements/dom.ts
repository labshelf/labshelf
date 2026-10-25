/**
 * Provides the reader's small DOM helpers: icon buttons, text-input detection and clamping.
 */
import { renderElement } from "../../../ui/dom/index.js";

/**
 * Icon-only button with an accessible name; the tooltip doubles as shortcut documentation.
 * @returns the button element.
 */
export function iconButton(iconHtml: string, title: string, extraClass = ""): HTMLButtonElement {
  return renderElement("button", {
    class: `rd-btn ${extraClass}`.trim(),
    type: "button",
    title,
    "aria-label": title,
    html: iconHtml,
  });
}

/**
 * @returns true when typing into the target should produce text rather than trigger single-key shortcuts.
 */
export function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) { return false; }
  if (target.isContentEditable) { return true; }
  if (target instanceof HTMLTextAreaElement) { return true; }
  if (target instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "color", "range"].includes(target.type);
  }
  return false;
}

/**
 * @returns `n` limited to [min, max].
 */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
