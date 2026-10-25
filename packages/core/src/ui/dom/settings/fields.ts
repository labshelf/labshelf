/** Builds the form controls for settings: checkbox, number, text and select over the shared input styles. */
import { renderElement } from "../dom.js";

/** `element` goes into the page; `control` is what code reads and writes. */
export interface Field<C extends HTMLElement> {
  element: HTMLElement;
  control: C;
}

export type FieldWidth = "sm" | "md";

const widthClass = (width?: FieldWidth): string => (width ? ` setting-input-${width}` : "");

export function renderCheckboxField(options: { id: string; label: string; checked?: boolean }): Field<HTMLInputElement> {
  const control = renderElement("input", { id: options.id, type: "checkbox" });
  control.checked = options.checked ?? false;
  return { element: renderElement("label", { class: "ls-checkbox" }, control, renderElement("span", { text: options.label })), control };
}

export function renderNumberField(options: { id: string; min: number; max: number; step: number; width?: FieldWidth }): Field<HTMLInputElement> {
  const control = renderElement("input", {
    id: options.id, class: `ls-input${widthClass(options.width)}`, type: "number", min: options.min, max: options.max, step: options.step,
  });
  return { element: control, control };
}

export function renderTextField(options: { id: string; type: "text" | "email" | "url"; placeholder?: string }): Field<HTMLInputElement> {
  const control = renderElement("input", { id: options.id, class: "ls-input", type: options.type, placeholder: options.placeholder });
  return { element: control, control };
}

export function renderPickField(options: { id: string; options: ReadonlyArray<{ value: string; label: string }>; width?: FieldWidth }): Field<HTMLSelectElement> {
  const control = renderElement("select", { id: options.id, class: `ls-input${widthClass(options.width)}` },
    ...options.options.map((o) => renderElement("option", { value: o.value, text: o.label })));
  return { element: control, control };
}
