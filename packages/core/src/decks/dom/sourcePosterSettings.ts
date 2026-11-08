// Poster Settings of a compiled (LaTeX or Typst) poster: the orientation toggle and the outer margin and section gap in cm, read from the
// source's layout. Each change goes to the port once; lengths reach it in mm. The header height follows the template, so it has no field.
import { renderElement } from "../../ui/dom/index.js";
import type { SourcePosterLayout } from "../sourceDeckPoster.js";

const cmText = (mm: number | null): string => (mm === null ? "" : String(Number((mm / 10).toFixed(2))));

export function createSourcePosterSettings(port: { layout(): import("../sourceDeckPoster.js").SourcePosterLayout | null; spacing(change: { margin?: number; gap?: number }): void; orientation(): void }): { element: HTMLElement; render(): void } {
  let layout: SourcePosterLayout | null = null;

  const orientationButton = (label: "Portrait" | "Landscape", landscape: boolean): HTMLButtonElement => {
    const button = renderElement("button", { type: "button", class: "dw-button dsh-segment", "aria-label": label, "aria-pressed": "false", text: label });
    button.addEventListener("click", () => {
      if (button.disabled || !layout || layout.landscape === null || layout.landscape === landscape) return;
      port.orientation();
    });
    return button;
  };
  const portrait = orientationButton("Portrait", false);
  const landscape = orientationButton("Landscape", true);

  const cmField = (label: string, key: "margin" | "gap"): { element: HTMLElement; input: HTMLInputElement } => {
    const input = renderElement("input", { type: "number", class: "dw-input", min: "0", step: "0.1" });
    input.addEventListener("change", () => {
      const cm = input.value.trim() === "" ? NaN : Number(input.value);
      const shown = layout?.[key] ?? null;
      if (shown === null || !Number.isFinite(cm) || cm < 0) { input.value = cmText(shown); return; }
      port.spacing(key === "margin" ? { margin: cm * 10 } : { gap: cm * 10 });
    });
    return { element: renderElement("label", { class: "dw-field" }, renderElement("span", { class: "dw-field-label", text: `${label} (cm)` }), input), input };
  };
  const margin = cmField("Outer margin", "margin");
  const gap = cmField("Section gap", "gap");

  const element = renderElement("aside", { class: "dw-props dsh-poster-settings", "aria-label": "Poster Settings" },
    renderElement("div", { class: "dw-panel-heading", text: "Poster Settings" }),
    renderElement("section", { class: "dsh-section" }, renderElement("div", { class: "dw-panel-heading", text: "Orientation" }), renderElement("div", { class: "dsh-row", role: "group", "aria-label": "Orientation" }, portrait, landscape)),
    renderElement("section", { class: "dsh-section" }, renderElement("div", { class: "dw-panel-heading", text: "Spacing" }), margin.element, gap.element),
    renderElement("p", { class: "dw-muted", text: "Header height follows the template in LaTeX and Typst." }));

  return {
    element,
    render() {
      layout = port.layout();
      const known = layout?.landscape ?? null;
      for (const [button, value] of [[portrait, false], [landscape, true]] as const) {
        button.disabled = known === null;
        button.setAttribute("aria-pressed", String(known === value));
      }
      for (const [field, key] of [[margin, "margin"], [gap, "gap"]] as const) {
        const mm = layout?.[key] ?? null;
        field.input.disabled = mm === null;
        if (document.activeElement !== field.input || mm === null) field.input.value = cmText(mm);
      }
    },
  };
}
