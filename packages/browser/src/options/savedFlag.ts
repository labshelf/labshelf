/** The "Saved" flag beside the page title: appears for two seconds after a setting is stored. */
import { el } from "@labshelf/core/dom";
import { icon } from "@labshelf/core";

const VISIBLE_MS = 2000;

export interface SavedFlag {
  element: HTMLElement;
  flash(): void;
}

export function createSavedFlag(): SavedFlag {
  const element = el("span", { class: "settings-saved", "aria-live": "polite", html: `${icon("check")}<span>Saved</span>` });
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    element,
    flash() {
      element.classList.add("show");
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => element.classList.remove("show"), VISIBLE_MS);
    },
  };
}
