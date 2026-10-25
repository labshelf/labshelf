/** Builds the frame of a settings page: the brand mark, the title, an optional slot at the right of the title, and the sections. */
import { renderIcon } from "../../icons/index.js";
import { renderElement } from "../dom.js";

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
