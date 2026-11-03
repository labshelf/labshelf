// The properties panel beside the HTML deck editor: the selected block's geometry (px for a talk, cm for a poster at 96 px per inch),
// its text style and, for a shape block, its fill and stroke; with nothing selected, Insert shape. Every change is one editor step.
import { renderElement } from "../../ui/dom/index.js";
import { applyDeckEdit, type DeckEditResult } from "../deckEdit.js";
import { readBlockShape, readBlockStyle, setBlockShapeStyle, setBlockStyle, shapeBlockHtml, type DeckShapeKind, type DeckTextDeclaration } from "../deckStyle.js";
import { deckCanvasPx } from "../deckSizes.js";
import type { DeckEditorView } from "./openDeckEditor.js";

/** What the panel edits through: the open editor's one-step edit. */
export interface DeckPropertiesTarget { edit(steps: Array<(html: string) => DeckEditResult>, label: string): void }

const PX_PER_CM = 96 / 2.54;
const FONTS: ReadonlyArray<[string, string]> = [["Theme", ""], ["Sans", "Inter, system-ui, sans-serif"], ["Serif", "Georgia, 'Times New Roman', serif"], ["Mono", "ui-monospace, Menlo, monospace"]];
const WEIGHTS = ["", "400", "500", "600", "700", "800"];
const ALIGNS = ["left", "center", "right", "justify"];
const SHAPES: ReadonlyArray<[DeckShapeKind, string]> = [["rect", "Rectangle"], ["ellipse", "Ellipse"], ["line", "Line"]];

function field(label: string, control: HTMLElement): HTMLElement {
  return renderElement("label", { class: "deck-props-field" }, renderElement("span", { class: "deck-props-label", text: label }), control);
}

function input(type: string, value: string, commit: (value: string) => void, extra: Record<string, string> = {}): HTMLInputElement {
  const element = renderElement("input", { type, class: "deck-props-input", value, ...extra });
  element.addEventListener("change", () => commit(element.value));
  return element;
}

function select(options: ReadonlyArray<[string, string]>, value: string, commit: (value: string) => void): HTMLSelectElement {
  const element = renderElement("select", { class: "deck-props-input" });
  for (const [label, option] of options) element.append(renderElement("option", { value: option, text: label, ...(option === value ? { selected: true } : {}) }));
  element.addEventListener("change", () => commit(element.value));
  return element;
}

const hexOf = (colour: string | undefined): string => (colour && /^#[0-9a-fA-F]{6}$/.test(colour) ? colour : "#000000");
const number = (value: string | undefined): string => (value ? String(Number.parseFloat(value) || "") : "");

/** Mounts the panel at the end of `host`; `render` follows the editor after each redraw. */
export function mountDeckProperties(host: HTMLElement, target: () => DeckPropertiesTarget | undefined): { element: HTMLElement; render(view: DeckEditorView): void } {
  const element = renderElement("aside", { class: "deck-props", "aria-label": "Properties" });
  host.classList.add("deck-editor-with-props");
  // Inline, so a host's own layout of its root (an id rule) cannot stack the panel under the editor.
  Object.assign(host.style, { display: "flex", flexDirection: "row", alignItems: "stretch" });
  host.append(element);
  let shown = "";
  const edit = (steps: Array<(html: string) => DeckEditResult>, label: string): void => target()?.edit(steps, label);

  return {
    element,
    render(view) {
      const { model, slide, blocks, html, readOnly } = view;
      const block = blocks.length === 1 ? model?.slides[slide]?.blocks.find((candidate) => candidate.id === blocks[0]) : undefined;
      const key = `${blocks.join()}|${block ? html.slice(block.range.from, block.range.to) : ""}|${slide}|${readOnly}`;
      // Keep the fields (and the one being typed in) while the panel's own block did not change.
      if (key === shown) return;
      shown = key;
      const poster = model?.kind === "poster";
      const unit = poster ? "cm" : "px";
      const toUnit = (px: number): string => String(poster ? Math.round((px / PX_PER_CM) * 100) / 100 : Math.round(px));
      const fromUnit = (value: string): number => (poster ? Number(value) * PX_PER_CM : Number(value));
      if (readOnly || !model) { element.replaceChildren(renderElement("p", { class: "deck-props-note", text: "Fix the deck's problems to edit its blocks." })); return; }
      if (!block) {
        const canvas = model.size ? deckCanvasPx(model.size) : { width: 1920, height: 1080 };
        const buttons = SHAPES.map(([kind, label]) => {
          const button = renderElement("button", { type: "button", class: "deck-props-button", text: label });
          button.addEventListener("click", () => {
            const taken = new Set(model.slides.flatMap((s) => s.blocks.map((b) => b.id)));
            let n = 1; while (taken.has(`shape-${n}`)) n++;
            const size = Math.round(Math.min(canvas.width, canvas.height) / 4);
            const rect = { left: Math.round((canvas.width - size) / 2), top: Math.round((canvas.height - size) / 2), width: size, height: kind === "line" ? 8 : size };
            edit([(current) => applyDeckEdit(current, { kind: "addBlock", slide, html: shapeBlockHtml(`shape-${n}`, kind, rect) })], "Insert shape");
          });
          return button;
        });
        element.replaceChildren(renderElement("div", { class: "deck-props-title", text: blocks.length > 1 ? `${blocks.length} blocks` : "Slide" }),
          renderElement("div", { class: "deck-props-section", text: "Insert shape" }), renderElement("div", { class: "deck-props-row" }, ...buttons),
          renderElement("p", { class: "deck-props-note", text: "Click a block to edit its text style and position." }));
        return;
      }
      const id = block.id;
      const style = readBlockStyle(html, block);
      const setStyle = (name: DeckTextDeclaration, value: string | null, label: string): void => edit([(current) => setBlockStyle(current, id, { [name]: value })], label);
      const rect = block.rect;
      const geometry = rect ? (["left", "top", "width", "height"] as const).map((side) => field(`${{ left: "X", top: "Y", width: "W", height: "H" }[side]} (${unit})`, input("number", toUnit(rect[side]), (value) => {
        const next = { ...rect, [side]: Math.round(fromUnit(value) * 100) / 100 };
        if (Number.isFinite(next[side])) edit([(current) => applyDeckEdit(current, { kind: "resize", block: id, ...next })], "Move block");
      }, { step: poster ? "0.1" : "1" }))) : [];
      const shape = readBlockShape(html, block);
      const parts: HTMLElement[] = [renderElement("div", { class: "deck-props-title", text: id }), renderElement("div", { class: "deck-props-section", text: "Position" }), renderElement("div", { class: "deck-props-grid" }, ...geometry)];
      if (shape) {
        parts.push(renderElement("div", { class: "deck-props-section", text: "Shape" }),
          field("Fill", input("color", hexOf(shape.style.fill), (value) => edit([(current) => setBlockShapeStyle(current, id, { fill: value })], "Shape fill"))),
          field("Stroke", input("color", hexOf(shape.style.stroke), (value) => edit([(current) => setBlockShapeStyle(current, id, { stroke: value })], "Shape stroke"))),
          field("Stroke width", input("number", String(shape.style.strokeWidth), (value) => edit([(current) => setBlockShapeStyle(current, id, { strokeWidth: Number(value) })], "Shape stroke"), { min: "0", max: "100" })));
      } else {
        parts.push(renderElement("div", { class: "deck-props-section", text: "Text style" }),
          field("Typeface", select(FONTS, style["font-family"] ?? "", (value) => setStyle("font-family", value || null, "Typeface"))),
          renderElement("div", { class: "deck-props-grid" },
            field("Size (px)", input("number", number(style["font-size"]), (value) => setStyle("font-size", value ? `${value}px` : null, "Text size"), { min: "4" })),
            field("Weight", select(WEIGHTS.map((w) => [w || "Theme", w]), style["font-weight"] ?? "", (value) => setStyle("font-weight", value || null, "Text weight"))),
            field("Line height", input("number", number(style["line-height"]), (value) => setStyle("line-height", value || null, "Line height"), { step: "0.1", min: "0.5" })),
            field("Padding (px)", input("number", number(style["padding"]), (value) => setStyle("padding", value ? `${value}px` : null, "Padding"), { min: "0" }))),
          field("Colour", input("color", hexOf(style["color"]), (value) => setStyle("color", value, "Text colour"))),
          field("Alignment", select([["Theme", ""], ...ALIGNS.map((a): [string, string] => [a[0]!.toUpperCase() + a.slice(1), a])], style["text-align"] ?? "", (value) => setStyle("text-align", value || null, "Alignment"))));
      }
      element.replaceChildren(...parts);
    },
  };
}
