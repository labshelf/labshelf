// The controls of a workspace (figure editor and the like): buttons, a toggle switch, a segmented choice, a collapsible
// section, labelled rows, text, number, select, colour and slider fields, and the rows of an object list.
import { renderElement } from "../dom.js";
import { renderIcon, type IconName } from "../../icons/index.js";

export type WsButtonVariant = "ghost" | "outline" | "primary" | "tool";

/** A button: an icon, a label, or both; `pressed` makes it a toggle button showing its state. */
export function wsButton(content: { icon?: IconName; label: string; showLabel?: boolean }, run: (button: HTMLButtonElement) => void, options: { variant?: WsButtonVariant; pressed?: boolean; extra?: string } = {}): HTMLButtonElement {
  const { icon, label, showLabel = icon === undefined } = content;
  const button = renderElement("button", { type: "button", class: `ws-btn ws-btn-${options.variant ?? "ghost"} ${options.extra ?? ""}`.trim(), title: label, "aria-label": label, html: icon ? renderIcon(icon) : "" });
  if (showLabel) button.append(renderElement("span", { text: label }));
  if (options.pressed !== undefined) button.setAttribute("aria-pressed", String(options.pressed));
  button.addEventListener("click", () => run(button));
  return button;
}

/** Sets a toggle button's pressed state. */
export const setPressed = (button: HTMLElement, on: boolean): void => button.setAttribute("aria-pressed", String(on));

/** A labelled switch; `set` changes it without reporting. */
export function wsToggle(label: string, on: boolean, onChange: (on: boolean) => void, icon?: IconName): { element: HTMLElement; set(on: boolean): void } {
  const knob = renderElement("button", { type: "button", class: "ws-switch", role: "switch", "aria-checked": String(on), "aria-label": label });
  knob.addEventListener("click", () => { const next = knob.getAttribute("aria-checked") !== "true"; knob.setAttribute("aria-checked", String(next)); onChange(next); });
  const element = renderElement("label", { class: "ws-toggle" }, icon ? renderElement("span", { class: "ws-icon", html: renderIcon(icon) }) : null, renderElement("span", { text: label }), knob);
  return { element, set: (next) => knob.setAttribute("aria-checked", String(next)) };
}

export interface WsOption { id: string; label: string; icon?: IconName }

/** A segmented choice of buttons; choosing the selected one again reports nothing. */
export function wsSegmented(options: readonly WsOption[], selected: string, onSelect: (id: string) => void, extra = ""): { element: HTMLElement; set(id: string): void } {
  const element = renderElement("div", { class: `ws-segmented ${extra}`.trim(), role: "radiogroup" });
  const set = (id: string): void => { for (const button of element.children) button.setAttribute("aria-checked", String((button as HTMLElement).dataset["id"] === id)); };
  for (const option of options) {
    const button = renderElement("button", { type: "button", role: "radio", class: "ws-segment", title: option.label, html: option.icon ? renderIcon(option.icon) : "" }, renderElement("span", { text: option.label }));
    button.dataset["id"] = option.id;
    button.addEventListener("click", () => { if (button.getAttribute("aria-checked") === "true") return; set(option.id); onSelect(option.id); });
    element.append(button);
  }
  set(selected);
  return { element, set };
}

/** A panel section with a heading, optional actions beside it and, when collapsible, a chevron that folds its body. */
export function wsSection(title: string, options: { collapsible?: boolean; open?: boolean; actions?: readonly HTMLElement[] } = {}): { element: HTMLElement; body: HTMLElement } {
  const body = renderElement("div", { class: "ws-section-body" });
  const heading = renderElement("div", { class: "ws-section-head" }, renderElement("h3", { class: "ws-section-title", text: title }), ...(options.actions ?? []));
  const element = renderElement("section", { class: "ws-section" }, heading, body);
  if (options.collapsible) {
    const chevron = wsButton({ icon: "chevron-down", label: `Show or hide ${title}` }, () => { body.hidden = !body.hidden; chevron.classList.toggle("is-closed", body.hidden); }, { extra: "ws-section-chevron" });
    heading.append(chevron);
    body.hidden = options.open === false;
    chevron.classList.toggle("is-closed", body.hidden);
  }
  return { element, body };
}

/** A row with its label on the left and the controls on the right. */
export function wsRow(label: string, ...controls: Array<Node | null>): HTMLElement {
  return renderElement("div", { class: "ws-row" }, renderElement("span", { class: "ws-row-label", text: label }), renderElement("div", { class: "ws-row-controls" }, ...controls));
}

/** A label above its control. */
export function wsField(label: string, control: Node): HTMLElement {
  return renderElement("div", { class: "ws-field" }, renderElement("span", { class: "ws-field-label", text: label }), control);
}

/** A text input that reports on change (blur) and on Enter. */
export function wsInput(value: string, onCommit: (value: string) => void, options: { placeholder?: string; mono?: boolean; label?: string; onInput?: (value: string) => void } = {}): HTMLInputElement {
  const input = renderElement("input", { type: "text", class: `ws-input${options.mono ? " ws-mono" : ""}`, value, placeholder: options.placeholder, "aria-label": options.label, spellcheck: "false" });
  input.addEventListener("change", () => onCommit(input.value));
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") input.blur(); });
  if (options.onInput) { const onInput = options.onInput; input.addEventListener("input", () => onInput(input.value)); }
  return input;
}

/** A number input; a committed value that is not a number is put back. */
export function wsNumber(value: number | null, onCommit: (value: number) => void, options: { step?: number; min?: number; max?: number; label?: string; placeholder?: string } = {}): HTMLInputElement {
  const shown = value === null ? "" : String(value);
  const input = renderElement("input", { type: "number", class: "ws-input ws-number", value: shown, step: options.step, min: options.min, max: options.max, "aria-label": options.label, placeholder: options.placeholder });
  input.addEventListener("change", () => {
    const n = Number(input.value);
    if (input.value.trim() === "" || !Number.isFinite(n)) { input.value = shown; return; }
    onCommit(Math.min(options.max ?? Infinity, Math.max(options.min ?? -Infinity, n)));
  });
  return input;
}

/** A native select. */
export function wsSelect(options: readonly { value: string; label: string }[], value: string, onChange: (value: string) => void, label?: string): HTMLSelectElement {
  const select = renderElement("select", { class: "ws-select", "aria-label": label }, ...options.map((o) => renderElement("option", { value: o.value, text: o.label })));
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

/** A colour: a swatch that opens the system picker and the hex beside it; both report `#rrggbb`. */
export function wsColour(value: string, onChange: (hex: string) => void, label = "Colour"): HTMLElement {
  const picker = renderElement("input", { type: "color", class: "ws-swatch-input", value: /^#[0-9a-f]{6}$/i.test(value) ? value : "#1f77b4", "aria-label": label });
  const hex = wsInput(value, (text) => { const t = text.trim().toLowerCase(); if (/^#[0-9a-f]{6}$/.test(t)) { picker.value = t; onChange(t); } else hex.value = picker.value; }, { mono: true, label: `${label} hex` });
  picker.addEventListener("input", () => { hex.value = picker.value; onChange(picker.value); });
  return renderElement("div", { class: "ws-colour" }, picker, hex);
}

/** A slider with its number box, kept in step; `onInput` gets each value while dragging. */
export function wsSlider(value: number, range: { min: number; max: number; step: number }, onInput: (value: number) => void, label: string): { element: HTMLElement; set(value: number): void } {
  const slider = renderElement("input", { type: "range", class: "ws-slider", min: range.min, max: range.max, step: range.step, value, "aria-label": label });
  const box = wsNumber(value, (n) => { slider.value = String(n); onInput(n); }, { step: range.step, label });
  slider.addEventListener("input", () => { box.value = slider.value; onInput(Number(slider.value)); });
  return { element: renderElement("div", { class: "ws-slider-row" }, slider, box), set(next) { slider.value = String(next); box.value = String(next); } };
}

export interface WsListRow { label: Node | string; sub?: string; swatch?: string; icon?: IconName; visible?: boolean; selected?: boolean; trailing?: readonly HTMLElement[] }

/** A row of an object list: visibility eye, swatch or icon, label and an optional line under it, trailing controls. */
export function wsListRow(row: WsListRow, handlers: { select(): void; toggle?(): void }): HTMLElement {
  const eye = row.visible === undefined || !handlers.toggle ? null : wsButton({ icon: row.visible ? "vs-eye" : "eye-closed", label: row.visible ? "Hide" : "Show" }, () => handlers.toggle!(), { extra: "ws-eye" });
  const mark = row.swatch ? renderElement("span", { class: "ws-dot", style: `background:${row.swatch}` }) : row.icon ? renderElement("span", { class: "ws-icon", html: renderIcon(row.icon) }) : null;
  const text = renderElement("span", { class: "ws-list-text" }, typeof row.label === "string" ? renderElement("span", { class: "ws-list-label", text: row.label }) : renderElement("span", { class: "ws-list-label" }, row.label), row.sub ? renderElement("span", { class: "ws-list-sub", text: row.sub }) : null);
  const element = renderElement("div", { class: `ws-list-row${row.selected ? " is-selected" : ""}${row.visible === false ? " is-hidden" : ""}`, role: "option", "aria-selected": String(row.selected === true), tabindex: "0" }, eye, mark, text, ...(row.trailing ?? []));
  element.addEventListener("click", (event) => { if (!(event.target as HTMLElement).closest(".ws-btn, select, input")) handlers.select(); });
  element.addEventListener("keydown", (event) => { if (event.key === "Enter" && event.target === element) handlers.select(); });
  return element;
}

/** A status line with a green check (or a warning mark when `ok` is false). */
export function wsCheck(text: string, ok = true): HTMLElement {
  return renderElement("span", { class: `ws-check${ok ? "" : " is-warn"}`, html: renderIcon(ok ? "pass-filled" : "warning") }, renderElement("span", { text }));
}
