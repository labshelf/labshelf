/** Shows the "Saved" flag beside the page title; it appears for two seconds after a setting is stored. */
import { renderElement } from "@labshelf/core/dom";
import { renderIcon } from "@labshelf/core";

const VISIBLE_MS = 2000;

export interface SavedNotice {
  element: HTMLElement;
  flash(): void;
}

export function createSavedNotice(): SavedNotice {
  const element = renderElement("span", { class: "settings-saved", "aria-live": "polite", html: `${renderIcon("check")}<span>Saved</span>` });
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
