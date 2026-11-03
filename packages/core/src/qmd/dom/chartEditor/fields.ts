// The small shared inputs of the chart editor's panels: number, text, select, check, segmented and colour (a swatch menu of the palette plus a hex field).
// Each has a visible label tied to its control; number and text fields commit on change (blur or Enter), never on each keystroke.
import { renderElement, renderSegmentedFilter, showPopover } from "../../../ui/dom/index.js";

let fieldCount = 0;

function nextId(): string {
  return `qmd-chart-field-${++fieldCount}`;
}

/** A field: its visible label tied to `control` by for=, then the control. */
function labelledField(label: string, control: HTMLElement): HTMLElement {
  control.id = nextId();
  return renderElement("div", { class: "qmd-chart-field" },
    renderElement("label", { class: "qmd-chart-field-label", for: control.id, text: label }),
    control);
}

/** A field whose input runs `commit` on change (blur) and on Enter. */
function committingField(label: string, input: HTMLInputElement, commit: () => void): HTMLElement {
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") commit(); });
  return labelledField(label, input);
}

function bounded(n: number, min: number | undefined, max: number | undefined): number {
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}

/** A number input under its label; a committed change reports the number (clamped to min and max), or null when emptied and `allowEmpty`. A value that is not a number is reverted. */
export function numberField(label: string, value: number | null, onChange: (value: number | null) => void, options: { step?: number; min?: number; max?: number; allowEmpty?: boolean } = {}): HTMLElement {
  const input = renderElement("input", { class: "qmd-chart-input", type: "number", step: options.step, min: options.min, max: options.max });
  let current = value;
  const show = (): void => { input.value = current === null ? "" : String(current); };
  show();
  const commit = (): void => {
    const raw = input.value.trim();
    let next: number | null;
    if (raw === "") {
      if (options.allowEmpty !== true) { show(); return; }
      next = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n)) { show(); return; }
      next = bounded(n, options.min, options.max);
    }
    if (next === current) { show(); return; }
    current = next;
    show();
    onChange(next);
  };
  return committingField(label, input, commit);
}

/** A text input under its label; a committed change reports the trimmed text. */
export function textField(label: string, value: string, onChange: (value: string) => void, placeholder?: string): HTMLElement {
  const input = renderElement("input", { class: "qmd-chart-input", type: "text", placeholder });
  let current = value;
  input.value = value;
  const commit = (): void => {
    const next = input.value.trim();
    if (next === current) return;
    current = next;
    onChange(next);
  };
  return committingField(label, input, commit);
}

/** A native select under its label; a change reports the chosen value. */
export function selectField(label: string, options: readonly { value: string; label: string }[], value: string, onChange: (value: string) => void): HTMLElement {
  const select = renderElement("select", { class: "qmd-chart-select" });
  for (const o of options) select.append(renderElement("option", { value: o.value, text: o.label }));
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  return labelledField(label, select);
}

/** A checkbox inside its label; a change reports whether it is checked. */
export function checkField(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
  const box = renderElement("input", { class: "qmd-chart-check", type: "checkbox" });
  box.checked = checked;
  box.addEventListener("change", () => onChange(box.checked));
  return renderElement("label", { class: "qmd-chart-check-field" }, box, renderElement("span", { text: label }));
}

/** A segmented choice (renderSegmentedFilter) under a visible label; choosing the selected option again reports nothing. */
export function segmentedField(label: string, options: readonly { id: string; label: string }[], selected: string, onSelect: (id: string) => void): HTMLElement {
  let current = selected;
  const group = renderSegmentedFilter({
    label,
    options,
    selected,
    onSelect(id) {
      if (id === current) return;
      current = id;
      onSelect(id);
    },
  });
  return renderElement("div", { class: "qmd-chart-field" }, renderElement("span", { class: "qmd-chart-field-label", "aria-hidden": "true", text: label }), group);
}

/** Names of the export palette's colours, so no swatch is told apart by colour alone. */
const COLOUR_NAMES: Record<string, string> = {
  "#1f77b4": "Blue", "#ff7f0e": "Orange", "#2ca02c": "Green", "#d62728": "Red", "#9467bd": "Purple",
  "#8c564b": "Brown", "#e377c2": "Pink", "#7f7f7f": "Grey", "#bcbd22": "Olive", "#17becf": "Cyan",
};

/** The name of a colour: its palette name and hex, or the hex alone. */
function colourName(hex: string, index?: number): string {
  const name = COLOUR_NAMES[hex.toLowerCase()];
  if (name !== undefined) return `${name} (${hex})`;
  return index === undefined ? hex : `Colour ${index + 1} (${hex})`;
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A colour: a swatch button opening a menu of the palette's named swatches, and a hex field; a choice or a committed valid hex reports `#rrggbb` (or `#rgb`) in lower case. */
export function colourField(label: string, value: string, palette: readonly string[], onChange: (value: string) => void): HTMLElement {
  let current = value;
  const button = renderElement("button", { class: "ls-btn qmd-chart-swatch-button", type: "button", "aria-haspopup": "menu" });
  const hex = renderElement("input", { class: "qmd-chart-input qmd-chart-hex", type: "text", "aria-label": `${label} hex`, spellcheck: "false", maxlength: 7 });
  const show = (): void => {
    const name = `${label}: ${colourName(current)}`;
    button.title = name;
    button.setAttribute("aria-label", name);
    button.style.setProperty("--qmd-chart-swatch", current);
    hex.value = current;
  };
  const set = (next: string): void => {
    if (next === current) { show(); return; }
    current = next;
    show();
    onChange(next);
  };
  show();
  hex.addEventListener("change", () => {
    const raw = hex.value.trim();
    if (!HEX.test(raw)) { show(); return; }
    set((raw.startsWith("#") ? raw : `#${raw}`).toLowerCase());
  });
  hex.addEventListener("keydown", (event) => { if (event.key === "Enter") hex.dispatchEvent(new Event("change")); });
  button.addEventListener("click", () => {
    showPopover(button, (close) => {
      const menu = renderElement("div", { class: "ls-menu qmd-chart-swatches", role: "menu", "aria-label": `${label} palette` });
      palette.forEach((colour, i) => {
        const name = colourName(colour, i);
        const swatch = renderElement("button", { class: "qmd-chart-swatch", type: "button", role: "menuitem", title: name, "aria-label": name });
        swatch.style.setProperty("--qmd-chart-swatch", colour);
        swatch.addEventListener("click", () => { close(); set(colour.toLowerCase()); });
        menu.append(swatch);
      });
      return menu;
    });
  });
  hex.id = nextId();
  return renderElement("div", { class: "qmd-chart-field" },
    renderElement("label", { class: "qmd-chart-field-label", for: hex.id, text: label }),
    renderElement("div", { class: "qmd-chart-colour" }, button, hex));
}
