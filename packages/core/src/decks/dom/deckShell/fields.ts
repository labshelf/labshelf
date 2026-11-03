// The form controls of the deck workspace's panels, on the workspace's dw-* classes: labelled fields, number and colour inputs,
// selects, toggle and segmented button rows, and icon buttons.
import { renderElement, renderIcon, type IconName } from "../../../ui/dom/index.js";

export function field(label: string, ...controls: HTMLElement[]): HTMLElement {
  return renderElement("label", { class: "dw-field" }, renderElement("span", { class: "dw-field-label", text: label }), ...controls);
}

export function section(title: string, ...children: HTMLElement[]): HTMLElement {
  return renderElement("section", { class: "dsh-section" }, renderElement("div", { class: "dsh-section-title", text: title }), ...children);
}

export const grid = (...children: HTMLElement[]): HTMLElement => renderElement("div", { class: "dsh-grid" }, ...children);

/** An input that commits on change (Enter or blur). */
export function input(type: string, value: string, commit: (value: string) => void, extra: Record<string, string> = {}): HTMLInputElement {
  const element = renderElement("input", { type, class: "dw-input", value, ...extra });
  element.addEventListener("change", () => commit(element.value));
  element.addEventListener("keydown", (event) => { event.stopPropagation(); if (event.key === "Enter") element.blur(); });
  return element;
}

export function select(options: ReadonlyArray<readonly [string, string]>, value: string, commit: (value: string) => void): HTMLSelectElement {
  const element = renderElement("select", { class: "dw-input" });
  for (const [label, option] of options) element.append(renderElement("option", { value: option, text: label, ...(option === value ? { selected: true } : {}) }));
  element.addEventListener("change", () => commit(element.value));
  return element;
}

const hexOf = (colour: string | undefined, fallback = "#000000"): string => (colour && /^#[0-9a-fA-F]{6}$/.test(colour) ? colour.toLowerCase() : fallback);

/** A colour swatch with its hex code beside it; either commits. */
export function colour(value: string | undefined, commit: (value: string) => void): HTMLElement {
  const hex = hexOf(value);
  const swatch = input("color", hex, commit, { class: "dsh-swatch" });
  const code = input("text", value ?? "", (next) => { if (/^#[0-9a-fA-F]{6}$/.test(next.trim())) commit(next.trim()); }, { class: "dw-input dsh-hex", placeholder: "Theme" });
  return renderElement("span", { class: "dw-input-row" }, swatch, code);
}

/** A button showing an icon or a short text, pressed when `on`. */
export function toggle(content: { icon?: IconName; text?: string; style?: string }, label: string, on: boolean, run: () => void): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: "dsh-toggle", title: label, "aria-label": label, "aria-pressed": String(on), ...(content.icon ? { html: renderIcon(content.icon) } : { text: content.text ?? "" }) });
  if (content.style) button.setAttribute("style", content.style);
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", run);
  return button;
}

export const row = (...children: HTMLElement[]): HTMLElement => renderElement("div", { class: "dsh-row" }, ...children);

/** A full-width labelled button. */
export function button(label: string, run: () => void, icon?: IconName): HTMLButtonElement {
  const element = renderElement("button", { type: "button", class: "dw-button", ...(icon ? { html: renderIcon(icon) } : {}) });
  element.append(renderElement("span", { text: label }));
  element.addEventListener("click", run);
  return element;
}

/** A tab row; the selected one is drawn as the workspace's tabs. */
export function tabs<T extends string>(names: ReadonlyArray<readonly [T, string]>, current: T, choose: (name: T) => void): HTMLElement {
  const element = renderElement("div", { class: "dw-tabs", role: "tablist" });
  for (const [name, label] of names) {
    const tab = renderElement("button", { type: "button", role: "tab", "aria-selected": String(name === current), text: label });
    tab.addEventListener("click", () => choose(name));
    element.append(tab);
  }
  return element;
}
