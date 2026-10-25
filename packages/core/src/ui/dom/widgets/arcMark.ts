// Renders an Arc mark as a focusable element named by its label, which appears beside it on hover or focus.
import { renderArcMarkSvg, type ArcProgress, type ArcTone } from "../../icons/index.js";
import { renderElement } from "../dom.js";

export function renderArcMarkElement(tone: ArcTone, progress: ArcProgress, label: string): HTMLElement {
  const mark = renderElement("span", { class: "ls-arc-mark", role: "img", "aria-label": label, tabindex: "0" },
    renderElement("span", { class: "ls-arc-mark-label", "aria-hidden": "true", text: label }));
  mark.insertAdjacentHTML("beforeend", renderArcMarkSvg(tone, progress));
  return mark;
}
