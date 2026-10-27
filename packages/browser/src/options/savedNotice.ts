/** Shows the "Saved" flag beside the page title; it appears for two seconds after a setting is stored. */
import { renderElement } from "@labshelf/core/dom";
import { createDebouncer, renderIcon } from "@labshelf/core";

const VISIBLE_MS = 2000;

export interface SavedNotice {
  element: HTMLElement;
  flash(): void;
}

export function createSavedNotice(): SavedNotice {
  const element = renderElement("span", { class: "settings-saved", "aria-live": "polite", html: `${renderIcon("check")}<span>Saved</span>` });
  const hide = createDebouncer(() => element.classList.remove("show"), VISIBLE_MS);
  return {
    element,
    flash() {
      element.classList.add("show");
      hide.call();
    },
  };
}
