// The drawing editor's toolbar (decision D6): grouped segments of ghost buttons, one pressed-state button per tool with its shortcut letter in the title, the colour, dash and weight controls for new and selected items (colour and dash open a small picker inside the editor), undo, redo and the one primary Done button. Every control has an accessible name; the active tool is told by aria-pressed, not by colour alone.
import { renderElement } from "../../../ui/dom/index.js";
import type { DrawingStyle } from "../../../drawing/index.js";
import type { Tool } from "./state.js";

export interface ToolbarActions { setTool(tool: Tool): void; setStyle(style: DrawingStyle): void; undo(): void; redo(): void; done(): void }

export interface Toolbar { readonly el: HTMLElement; update(tool: Tool, style: DrawingStyle, canUndo: boolean, canRedo: boolean): void }

/** One 16 px icon set: 1.5 px strokes, round caps and joins, each glyph optically centred in the box. Kept here because the generated codicon table would put the editor chunk over its 60 KB budget. */
const ICONS: Record<string, string> = {
  select: '<path d="M4 3l9 4.6-4.1 1.2-1.6 4.2z"/>',
  point: '<circle cx="8" cy="8" r="2.4" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="5.6" opacity=".35"/>',
  line: '<path d="M3.5 12.5l9-9"/>',
  arrow: '<path d="M3.5 12.5l9-9M7.5 3.5h5v5"/>',
  circle: '<circle cx="8" cy="8" r="5.2"/>',
  rect: '<rect x="3" y="3.5" width="10" height="9" rx="1"/>',
  function: '<path d="M3.5 3v10h10M5.5 11c1.4-6.5 2.8-6.5 4.2-1s2.4 .5 3.3-3.5"/>',
  label: '<path d="M4 4.5h8M8 4.5v7.5M6.5 12h3"/>',
  undo: '<path d="M6 4.5L3 7.5l3 3M3 7.5h6.5a3 3 0 0 1 0 6H8"/>',
  redo: '<path d="M10 4.5l3 3-3 3M13 7.5H6.5a3 3 0 0 0 0 6H8"/>',
  thick: '<path d="M3 5h10"/><path d="M3 10.5h10" stroke-width="3"/>',
  solid: '<path d="M3 8h10"/>',
  dashed: '<path d="M3 8h10" stroke-dasharray="3 2.2"/>',
  dotted: '<path d="M3 8h10" stroke-dasharray="0 2.6"/>',
  caret: '<path d="M4 6l4 4 4-4"/>',
};

const TOOLS: Array<[Tool, string, string]> = [
  ["select", "Select", "V"], ["point", "Point", "P"], ["line", "Line", "L"], ["arrow", "Arrow", "A"],
  ["circle", "Circle", "C"], ["rect", "Rectangle", "R"], ["function", "Function", "F"], ["label", "Label", "T"],
];

/** TikZ colour names the colour control offers; the empty value is the document colour. The swatch shows the paint the drawing itself uses (the SVG renderer writes the same name). */
const COLOURS: Array<[string, string]> = [["", "Default"], ["red", "Red"], ["blue", "Blue"], ["green", "Green"], ["orange", "Orange"], ["violet", "Violet"], ["gray", "Gray"]];
const DASHES: Array<[string, string]> = [["", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"]];

function svg(inner: string, cls = ""): string {
  return `<svg class="${cls}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
}

const icon = (name: string): string => svg(ICONS[name] ?? "");
const swatch = (colour: string): string => svg(`<circle class="qmd-drawing-swatch" cx="8" cy="8" r="5" fill="${colour || "currentColor"}" stroke="none"/>`);
const dashIcon = (dash: string): string => icon(dash || "solid");

function iconButton(html: string, label: string, title: string): HTMLButtonElement {
  return renderElement("button", { type: "button", class: "ls-btn ls-btn-ghost qmd-drawing-tool", "aria-label": label, title, html });
}

const group = (...children: HTMLElement[]): HTMLElement => renderElement("span", { class: "qmd-drawing-toolbar-group" }, ...children);

// ---- picker: a button whose face shows the current choice and a small popover of choices under it ----

interface Picker { readonly el: HTMLElement; set(value: string): void }

/** `face(value)` draws the button's face; the popover lists every option as a pressed-state button. Escape, a pick or a press elsewhere close it; arrows move between options. */
function createPicker(label: string, options: Array<[string, string]>, face: (value: string) => string, onPick: (value: string) => void): Picker {
  const button = renderElement("button", { type: "button", class: "ls-btn ls-btn-ghost qmd-drawing-tool qmd-drawing-pick-button", "aria-haspopup": "true", "aria-expanded": "false" });
  const pop = renderElement("div", { class: "qmd-drawing-pop", role: "group", "aria-label": label });
  pop.hidden = true;
  const el = renderElement("span", { class: "qmd-drawing-pick" }, button, pop);
  let current = "";
  const choices = options.map(([value, text]) => {
    const choice = renderElement("button", { type: "button", class: "qmd-drawing-opt", "aria-label": text, title: text, "aria-pressed": "false", html: face(value) });
    choice.addEventListener("click", () => { close(); button.focus(); onPick(value); });
    pop.append(choice);
    return choice;
  });
  const onOutside = (event: Event): void => { if (!(event.target instanceof Node && el.contains(event.target))) { close(); } };
  function close(): void {
    if (pop.hidden) { return; }
    pop.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
  }
  function open(): void {
    pop.hidden = false;
    button.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onOutside, true);
    (choices.find((c) => c.getAttribute("aria-pressed") === "true") ?? choices[0])?.focus();
  }
  button.addEventListener("click", () => { if (pop.hidden) { open(); } else { close(); } });
  el.addEventListener("keydown", (event) => {
    if (pop.hidden) { return; }
    const index = choices.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") { close(); button.focus(); } else if (event.key === "ArrowRight" || event.key === "ArrowDown") { choices[(index + 1) % choices.length]?.focus(); } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") { choices[(index - 1 + choices.length) % choices.length]?.focus(); } else { return; }
    event.preventDefault();
    event.stopPropagation();
  });
  const set = (value: string): void => {
    current = value;
    const text = options.find(([v]) => v === value)?.[1] ?? value;
    button.innerHTML = face(value) + svg(ICONS.caret ?? "", "qmd-drawing-caret");
    button.setAttribute("aria-label", `${label}: ${text}`);
    button.title = `${label}: ${text}`;
    choices.forEach((choice, i) => choice.setAttribute("aria-pressed", options[i]?.[0] === value ? "true" : "false"));
  };
  set(current);
  return { el, set };
}

export function createToolbar(actions: ToolbarActions): Toolbar {
  const el = renderElement("div", { class: "qmd-drawing-toolbar", role: "toolbar", "aria-label": "Drawing tools" });
  const toolButtons = new Map<Tool, HTMLButtonElement>();
  for (const [tool, label, key] of TOOLS) {
    const button = iconButton(icon(tool), label, `${label} (${key})`);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => actions.setTool(tool));
    toolButtons.set(tool, button);
  }
  const separator = (): HTMLElement => renderElement("span", { class: "qmd-drawing-toolbar-sep", role: "separator" });

  const style: { color: string; dash: string; thick: boolean } = { color: "", dash: "", thick: false };
  const readStyle = (): DrawingStyle => ({
    ...(style.color ? { color: style.color } : {}),
    ...(style.dash === "dashed" || style.dash === "dotted" ? { dash: style.dash } : {}),
    ...(style.thick ? { thick: true } : {}),
  });
  const colour = createPicker("Colour", COLOURS, swatch, (value) => { style.color = value; actions.setStyle(readStyle()); });
  const dash = createPicker("Dash", DASHES, dashIcon, (value) => { style.dash = value; actions.setStyle(readStyle()); });
  const thick = iconButton(icon("thick"), "Thick", "Thick lines");
  thick.setAttribute("aria-pressed", "false");
  thick.addEventListener("click", () => { style.thick = !style.thick; actions.setStyle(readStyle()); });

  const undo = iconButton(icon("undo"), "Undo", "Undo (Mod+Z)");
  const redo = iconButton(icon("redo"), "Redo", "Redo (Shift+Mod+Z)");
  undo.addEventListener("click", () => actions.undo());
  redo.addEventListener("click", () => actions.redo());
  const done = renderElement("button", { type: "button", class: "ls-btn ls-btn-primary qmd-drawing-done", text: "Done", title: "Close the editor and keep the drawing (Esc)" });
  done.addEventListener("click", () => actions.done());
  el.append(group(...toolButtons.values()), separator(), group(colour.el, dash.el, thick), separator(), group(undo, redo), done);

  return {
    el,
    update(tool, next, canUndo, canRedo) {
      for (const [name, button] of toolButtons) { button.setAttribute("aria-pressed", name === tool ? "true" : "false"); }
      style.color = next.color && COLOURS.some(([value]) => value === next.color) ? next.color : "";
      style.dash = next.dash ?? "";
      style.thick = next.thick === true;
      colour.set(style.color);
      dash.set(style.dash);
      thick.setAttribute("aria-pressed", style.thick ? "true" : "false");
      undo.disabled = !canUndo;
      redo.disabled = !canRedo;
    },
  };
}
