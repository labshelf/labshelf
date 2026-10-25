/** Builds a settings section: a rule, a heading, an optional description, and the settings or actions it groups. */
import { renderElement } from "../dom.js";

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
