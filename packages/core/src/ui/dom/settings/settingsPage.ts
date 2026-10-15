/** Builds the frame of a settings page: the brand mark, the title, an optional slot at the right of the title, and the sections. */
import { icon } from "../../icons/index.js";
import { el } from "../dom.js";

export interface SettingsPageOptions {
  title: string;
  /** Sits at the right of the title, e.g. a "Saved" flag. */
  aside?: Node;
}

export function settingsPage(options: SettingsPageOptions, ...sections: Node[]): HTMLElement {
  const head = el(
    "header",
    { class: "settings-head" },
    el("span", { class: "ls-brand", html: icon("logo") }),
    el("h1", { text: options.title }),
    options.aside,
  );
  return el("main", { class: "settings" }, head, ...sections);
}
