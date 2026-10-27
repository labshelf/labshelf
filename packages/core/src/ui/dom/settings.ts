/** Settings page components shared by the VS Code settings webview and the browser options page: page, section, row, fields, tone line and action button. */
import { renderIcon, type IconName } from "../icons/index.js";
import { renderElement } from "./dom.js";

/** Text or nodes; strings become text nodes, so no markup is ever injected. */
export type SettingsContent = string | Node | ReadonlyArray<string | Node>;

export interface SettingsSectionOptions {
  title: string;
  description?: SettingsContent;
}

export function renderContentNodes(content: SettingsContent): Array<string | Node> {
  return typeof content === "string" || content instanceof Node ? [content] : [...content];
}

export function renderSettingsSection(options: SettingsSectionOptions, ...children: Node[]): HTMLElement {
  const description = options.description === undefined
    ? null
    : renderElement("p", { class: "settings-desc" }, ...renderContentNodes(options.description));
  return renderElement("section", { class: "settings-section" }, renderElement("h2", { text: options.title }), description, ...children);
}

/** A monospace span for a value or setting name inside a description. */
export function renderInlineCode(text: string): HTMLElement {
  return renderElement("code", { text });
}

export interface SettingRowOptions {
  label?: string;
  /** Ties the label to a control by id; without it the label is plain text (e.g. for a group of buttons). */
  labelFor?: string;
  description?: SettingsContent;
}

function labelNode(options: SettingRowOptions): HTMLElement | null {
  if (options.label === undefined) { return null; }
  return options.labelFor
    ? renderElement("label", { class: "setting-label", for: options.labelFor, text: options.label })
    : renderElement("span", { class: "setting-label", text: options.label });
}

/** Labelled rows read label, description, control; a row without a label (a checkbox carries its own) reads control, description. */
export function renderSettingRow(options: SettingRowOptions, control: Node): HTMLElement {
  const label = labelNode(options);
  const description = options.description === undefined
    ? null
    : renderElement("div", { class: "setting-desc" }, ...renderContentNodes(options.description));
  return renderElement("div", { class: "setting" }, label, ...(label ? [description, control] : [control, description]));
}

/** Dims a setting that has no effect while another one is off. */
export function setRowDisabled(row: HTMLElement, disabled: boolean): void {
  row.classList.toggle("disabled", disabled);
}

export interface SettingsPageOptions {
  title: string;
  /** Sits at the right of the title, e.g. a "Saved" flag. */
  aside?: Node;
}

export function renderSettingsPage(options: SettingsPageOptions, ...sections: Node[]): HTMLElement {
  const head = renderElement(
    "header",
    { class: "settings-head" },
    renderElement("span", { class: "ls-brand", html: renderIcon("logo") }),
    renderElement("h1", { text: options.title }),
    options.aside,
  );
  return renderElement("main", { class: "settings" }, head, ...sections);
}

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

export type ToneLineKind = "ok" | "error" | "idle";

export interface ToneLine {
  element: HTMLElement;
  set(text: string, tone: ToneLineKind, error?: string | null): void;
}

const DOT_CLASS: Record<ToneLineKind, string> = { ok: "ls-dot s-ok", error: "ls-dot s-error", idle: "ls-dot" };

export function createToneLine(): ToneLine {
  const dot = renderElement("span", { class: DOT_CLASS.idle });
  const text = renderElement("span");
  const error = renderElement("span", { class: "settings-status-error" });
  const element = renderElement("div", { class: "settings-status", role: "status" }, dot, text, error);
  return {
    element,
    set(next, tone, message) {
      dot.className = DOT_CLASS[tone];
      text.textContent = next;
      error.textContent = message ? ` — ${message}` : "";
    },
  };
}

export interface ActionButtonOptions {
  label: string;
  icon: IconName;
  primary?: boolean;
  /** Handlers report their own failures; the button only waits for them. */
  onClick: () => void | Promise<void>;
}

export function renderActionButton(options: ActionButtonOptions): HTMLButtonElement {
  const button = renderElement("button", { class: `ls-btn${options.primary ? " ls-btn-primary" : ""}`, type: "button", html: renderIcon(options.icon) });
  button.append(renderElement("span", { text: options.label }));
  button.addEventListener("click", () => {
    button.disabled = true;
    void (async () => {
      try { await options.onClick(); } finally { button.disabled = false; }
    })();
  });
  return button;
}
