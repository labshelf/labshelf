/** A settings section: a rule, a heading, an optional description, and the settings or actions it groups. */
import { el } from "../dom.js";

/** Text or nodes; strings become text nodes, so no markup is ever injected. */
export type SettingsContent = string | Node | ReadonlyArray<string | Node>;

export interface SettingsSectionOptions {
  title: string;
  description?: SettingsContent;
}

export function contentNodes(content: SettingsContent): Array<string | Node> {
  return typeof content === "string" || content instanceof Node ? [content] : [...content];
}

export function settingsSection(options: SettingsSectionOptions, ...children: Node[]): HTMLElement {
  const description = options.description === undefined
    ? null
    : el("p", { class: "settings-desc" }, ...contentNodes(options.description));
  return el("section", { class: "settings-section" }, el("h2", { text: options.title }), description, ...children);
}

/** A monospace span for a value or setting name inside a description. */
export function inlineCode(text: string): HTMLElement {
  return el("code", { text });
}
