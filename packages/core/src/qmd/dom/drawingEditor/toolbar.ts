// The drawing editor's toolbar (decision D6): one pressed-state button per tool with its shortcut letter in the title, the colour, dash and thick style controls for new and selected items, undo, redo and a text Done button. Every control has an accessible name; the active tool is told by aria-pressed, not by colour alone.
import { renderElement } from "../../../ui/dom/index.js";
import type { DrawingStyle } from "../../drawing/index.js";
import type { Tool } from "./state.js";

export interface ToolbarActions { setTool(tool: Tool): void; setStyle(style: DrawingStyle): void; undo(): void; redo(): void; done(): void }

export interface Toolbar { readonly el: HTMLElement; update(tool: Tool, style: DrawingStyle, canUndo: boolean, canRedo: boolean): void }

/** Tiny 16x16 stroke icons in the shared set's style, kept here because the generated codicon table would put the editor chunk over its 60 KB budget. */
const ICONS: Record<string, string> = {
  select: '<path d="M4 2.5 12.5 9 8.3 9.7 6 13.5z"/>',
  point: '<circle cx="8" cy="8" r="2.5" fill="currentColor"/>',
  line: '<path d="M3 13 13 3"/>',
  arrow: '<path d="M3 13 13 3M7.5 3H13v5.5"/>',
  circle: '<circle cx="8" cy="8" r="5.5"/>',
  rect: '<rect x="2.5" y="3.5" width="11" height="9"/>',
  function: '<path d="M2 13h12M3 14V2M4 11c3-9 5 6 9-3"/>',
  label: '<path d="M3 3h10M8 3v10"/>',
  undo: '<path d="M3 7h7a3 3 0 0 1 0 6H6M3 7l3-3M3 7l3 3"/>',
  redo: '<path d="M13 7H6a3 3 0 0 0 0 6h4M13 7l-3-3M13 7l-3 3"/>',
  thick: '<path d="M3 5h10"/><path d="M3 11h10" stroke-width="3"/>',
};

const TOOLS: Array<[Tool, string, string]> = [
  ["select", "Select", "V"], ["point", "Point", "P"], ["line", "Line", "L"], ["arrow", "Arrow", "A"],
  ["circle", "Circle", "C"], ["rect", "Rectangle", "R"], ["function", "Function", "F"], ["label", "Label", "T"],
];

/** TikZ colour names the colour control offers; the empty value is the document colour. */
const COLOURS: Array<[string, string]> = [["", "Default"], ["red", "Red"], ["blue", "Blue"], ["green", "Green"], ["orange", "Orange"], ["violet", "Violet"], ["gray", "Gray"]];
const DASHES: Array<[string, string]> = [["", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"]];

function icon(name: string): string {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] ?? ""}</svg>`;
}

function iconButton(name: string, label: string, title: string): HTMLButtonElement {
  return renderElement("button", { type: "button", class: "ls-btn ls-btn-ghost qmd-drawing-tool", "aria-label": label, title, html: icon(name) });
}

function select(label: string, options: Array<[string, string]>): HTMLSelectElement {
  return renderElement("select", { class: "qmd-drawing-select", "aria-label": label, title: label }, ...options.map(([value, text]) => renderElement("option", { value, text })));
}

export function createToolbar(actions: ToolbarActions): Toolbar {
  const el = renderElement("div", { class: "qmd-drawing-toolbar", role: "toolbar", "aria-label": "Drawing tools" });
  const toolButtons = new Map<Tool, HTMLButtonElement>();
  for (const [tool, label, key] of TOOLS) {
    const button = iconButton(tool, label, `${label} (${key})`);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => actions.setTool(tool));
    toolButtons.set(tool, button);
    el.append(button);
  }
  const separator = (): HTMLElement => renderElement("span", { class: "qmd-drawing-toolbar-sep", role: "separator" });
  el.append(separator());

  const colour = select("Colour", COLOURS);
  const dash = select("Dash", DASHES);
  const thick = iconButton("thick", "Thick", "Thick lines");
  thick.setAttribute("aria-pressed", "false");
  const readStyle = (): DrawingStyle => ({
    ...(colour.value ? { color: colour.value } : {}),
    ...(dash.value === "dashed" || dash.value === "dotted" ? { dash: dash.value } : {}),
    ...(thick.getAttribute("aria-pressed") === "true" ? { thick: true } : {}),
  });
  colour.addEventListener("change", () => actions.setStyle(readStyle()));
  dash.addEventListener("change", () => actions.setStyle(readStyle()));
  thick.addEventListener("click", () => {
    thick.setAttribute("aria-pressed", thick.getAttribute("aria-pressed") === "true" ? "false" : "true");
    actions.setStyle(readStyle());
  });
  el.append(colour, dash, thick, separator());

  const undo = iconButton("undo", "Undo", "Undo (Mod+Z)");
  const redo = iconButton("redo", "Redo", "Redo (Shift+Mod+Z)");
  undo.addEventListener("click", () => actions.undo());
  redo.addEventListener("click", () => actions.redo());
  const done = renderElement("button", { type: "button", class: "ls-btn qmd-drawing-done", text: "Done", title: "Close the editor and keep the drawing (Esc)" });
  done.addEventListener("click", () => actions.done());
  el.append(undo, redo, done);

  return {
    el,
    update(tool, style, canUndo, canRedo) {
      for (const [name, button] of toolButtons) { button.setAttribute("aria-pressed", name === tool ? "true" : "false"); }
      colour.value = style.color && COLOURS.some(([value]) => value === style.color) ? style.color : "";
      dash.value = style.dash ?? "";
      thick.setAttribute("aria-pressed", style.thick ? "true" : "false");
      undo.disabled = !canUndo;
      redo.disabled = !canRedo;
    },
  };
}
