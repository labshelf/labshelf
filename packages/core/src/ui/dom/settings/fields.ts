/** Form controls for settings: checkbox, number, text and select over the shared input styles. */
import { el } from "../dom.js";

/** `element` goes into the page; `control` is what code reads and writes. */
export interface Field<C extends HTMLElement> {
  element: HTMLElement;
  control: C;
}

export type FieldWidth = "sm" | "md";

const widthClass = (width?: FieldWidth): string => (width ? ` setting-input-${width}` : "");

export function checkboxField(options: { id: string; label: string; checked?: boolean }): Field<HTMLInputElement> {
  const control = el("input", { id: options.id, type: "checkbox" });
  control.checked = options.checked ?? false;
  return { element: el("label", { class: "ls-checkbox" }, control, el("span", { text: options.label })), control };
}

export function numberField(options: { id: string; min: number; max: number; step: number; width?: FieldWidth }): Field<HTMLInputElement> {
  const control = el("input", {
    id: options.id, class: `ls-input${widthClass(options.width)}`, type: "number", min: options.min, max: options.max, step: options.step,
  });
  return { element: control, control };
}

export function textField(options: { id: string; type: "text" | "email" | "url"; placeholder?: string }): Field<HTMLInputElement> {
  const control = el("input", { id: options.id, class: "ls-input", type: options.type, placeholder: options.placeholder });
  return { element: control, control };
}

export function selectField(options: { id: string; options: ReadonlyArray<{ value: string; label: string }>; width?: FieldWidth }): Field<HTMLSelectElement> {
  const control = el("select", { id: options.id, class: `ls-input${widthClass(options.width)}` },
    ...options.options.map((o) => el("option", { value: o.value, text: o.label })));
  return { element: control, control };
}
