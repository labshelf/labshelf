// Size picker: the D2 presets of a deck kind as radios, a poster orientation toggle and custom sizes, applied only within range.
import { renderElement } from "../../ui/dom/index.js";
import { createToolbarPopover, type ToolbarPopover } from "./themePanel.js";
import { isDeckSizeAllowed, listDeckSizePresets, type DeckKind, type DeckSize } from "../deckSizes.js";

export interface SizePickerOptions { kind: DeckKind; size: DeckSize; onApply(size: DeckSize): void }

const MESSAGES: Record<DeckKind, string> = {
  talk: "Talk sizes are 320 to 7680 px per side.",
  poster: "Poster sizes are 100 to 2000 mm (3.9 to 78.7 in) per side.",
};
const CUSTOM = "custom";
let groups = 0;

const sameSize = (a: DeckSize, b: DeckSize): boolean => a.w === b.w && a.h === b.h && a.unit === b.unit;

interface CustomControls { width: HTMLInputElement; height: HTMLInputElement; unit: HTMLSelectElement; fields: Array<Node | string> }

/** The custom width, height and unit fields, filled from the current size; any change calls onInput. */
function customControls(kind: DeckKind, size: DeckSize, onInput: () => void): CustomControls {
  const width = renderElement("input", { type: "text", inputmode: "decimal", class: "deck-editor-size-input", "aria-label": "Width" });
  const height = renderElement("input", { type: "text", inputmode: "decimal", class: "deck-editor-size-input", "aria-label": "Height" });
  const units = kind === "talk" ? ["px"] : ["mm", "in"];
  const unit = renderElement("select", { class: "deck-editor-size-unit", "aria-label": "Unit" }, ...units.map((value) => renderElement("option", { value, text: value })));
  width.value = String(size.w);
  height.value = String(size.h);
  unit.value = units.includes(size.unit) ? size.unit : units[0]!;
  for (const control of [width, height, unit]) for (const type of ["input", "change"]) control.addEventListener(type, onInput);
  return { width, height, unit, fields: [width, "×", height, unit] };
}

/** The size the custom fields describe, rounded to whole px or tenths of mm and in. */
function customSize(controls: CustomControls): DeckSize {
  const number = (input: HTMLInputElement): number => (input.value.trim() === "" ? NaN : Number(input.value.trim()));
  const rounded = (value: number): number => (controls.unit.value === "px" ? Math.round(value) : Math.round(value * 10) / 10);
  return { w: rounded(number(controls.width)), h: rounded(number(controls.height)), unit: controls.unit.value as DeckSize["unit"] };
}

/** A preset turned to the chosen orientation; a square preset stays as it is. */
function orientedPreset(size: DeckSize, landscape: boolean): DeckSize {
  const { w, h } = size;
  return w === h || (w > h) === landscape ? size : { w: h, h: w, unit: size.unit };
}

/** The Portrait and Landscape toggles of a poster; a talk has none. */
function orientationButtons(kind: DeckKind, onPick: (landscape: boolean) => void): HTMLButtonElement[] {
  if (kind !== "poster") return [];
  return (["Portrait", "Landscape"] as const).map((name) => {
    const button = renderElement("button", { type: "button", class: "ls-btn ls-btn-ghost deck-editor-tool", text: name });
    button.addEventListener("click", () => onPick(name === "Landscape"));
    return button;
  });
}

function syncOrientation(buttons: readonly HTMLButtonElement[], landscape: boolean, disabled: boolean): void {
  buttons.forEach((button) => {
    button.setAttribute("aria-pressed", String((button.textContent === "Landscape") === landscape));
    button.disabled = disabled;
  });
}

/** Applies an allowed size, or shows the range of the kind under the picker. */
function applyChoice(kind: DeckKind, size: DeckSize, error: HTMLElement, onApply: (size: DeckSize) => void): void {
  if (!isDeckSizeAllowed(kind, size)) {
    error.textContent = MESSAGES[kind];
    return;
  }
  error.textContent = "";
  onApply({ ...size });
}

export function mountSizePicker(host: HTMLElement, options: SizePickerOptions): { readonly element: HTMLElement; destroy(): void } {
  const { kind } = options;
  const presets = listDeckSizePresets(kind);
  const group = `deck-editor-size-${++groups}`;
  let selected = presets.find((preset) => sameSize(preset.size, options.size))?.id ?? CUSTOM;
  let landscape = options.size.w > options.size.h;

  const radio = (id: string, label: string): HTMLInputElement => {
    const input = renderElement("input", { type: "radio", name: group, value: id, "aria-label": label });
    input.checked = selected === id;
    input.addEventListener("change", () => select(id));
    return input;
  };
  const presetRadios = presets.map((preset) => radio(preset.id, preset.label));
  const presetList = renderElement("div", { class: "deck-editor-size-presets", role: "group", "aria-label": "Preset sizes" },
    ...presets.map((preset, index) => renderElement("label", { class: "deck-editor-size-option" }, presetRadios[index], preset.label)));

  const orientButtons = orientationButtons(kind, (next) => { landscape = next; sync(); });
  const orientation = orientButtons.length > 0 ? renderElement("div", { class: "deck-editor-size-orientation", role: "group", "aria-label": "Orientation" }, ...orientButtons) : null;

  const customRadio = radio(CUSTOM, "Custom");
  const controls = customControls(kind, options.size, () => select(CUSTOM));
  const custom = renderElement("div", { class: "deck-editor-size-custom" }, renderElement("label", { class: "deck-editor-size-option" }, customRadio, "Custom"), ...controls.fields);

  const error = renderElement("p", { class: "deck-editor-size-error", role: "alert" });
  const applyButton = renderElement("button", { type: "button", class: "ls-btn deck-editor-size-apply", "aria-label": "Apply", text: "Apply" });
  const element = renderElement("div", { class: "deck-editor-size" }, presetList, orientation, custom, error, applyButton);
  host.append(element);

  function sync(): void {
    presetRadios.forEach((input, index) => { input.checked = selected === presets[index]!.id; });
    customRadio.checked = selected === CUSTOM;
    syncOrientation(orientButtons, landscape, selected === CUSTOM);
  }
  function select(id: string): void {
    selected = id;
    const preset = presets.find((candidate) => candidate.id === id);
    if (preset) landscape = preset.size.w > preset.size.h;
    sync();
  }

  applyButton.addEventListener("click", () => {
    const preset = presets.find((candidate) => candidate.id === selected);
    applyChoice(kind, preset ? orientedPreset(preset.size, landscape) : customSize(controls), error, options.onApply);
  });
  sync();
  return { element, destroy: () => element.remove() };
}

/** The Size toolbar button: its popover holds a picker for the current kind and size, and closes when a size is applied. */
export function createSizePopover(options: { current(): { kind: DeckKind | null; size: DeckSize | null } | undefined; onApply(size: DeckSize): void }): ToolbarPopover {
  const popover: ToolbarPopover = createToolbarPopover("Size", "Change the slide size", (pop) => {
    const current = options.current();
    const picker = mountSizePicker(pop, { kind: current?.kind ?? "talk", size: current?.size ?? { w: 1920, h: 1080, unit: "px" }, onApply: (size) => { popover.close(); options.onApply(size); } });
    return { destroy: picker.destroy };
  });
  return popover;
}
