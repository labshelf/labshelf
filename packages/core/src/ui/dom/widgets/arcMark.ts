// Renders an Arc mark as a focusable element named by its label, which appears beside it on hover or focus.
import { arcMark, type ArcProgress, type ArcTone } from "../../icons/index.js";
import { el } from "../dom.js";

export function arcMarkElement(tone: ArcTone, progress: ArcProgress, label: string): HTMLElement {
  const mark = el("span", { class: "ls-arc-mark", role: "img", "aria-label": label, tabindex: "0" },
    el("span", { class: "ls-arc-mark-label", "aria-hidden": "true", text: label }));
  mark.insertAdjacentHTML("beforeend", arcMark(tone, progress));
  return mark;
}
