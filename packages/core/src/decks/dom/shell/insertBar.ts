// The shell's insert toolbar: groups of labelled buttons and menus, and end items at the right.
import { renderElement, renderIcon, showMenu, type IconName } from "../../../ui/dom/index.js";
import type { InsertItem } from "./types.js";

/** A labelled button (icon and text) with aria-label and title, keeping editor focus on mousedown. */
export function shellButton(icon: IconName, label: string, className: string, run: (button: HTMLButtonElement) => void): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: className, title: label, "aria-label": label, html: renderIcon(icon) });
  button.append(renderElement("span", { text: label }));
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => run(button));
  return button;
}

/** The insert toolbar: groups of labelled buttons and menus, and `end` items at the right end. */
export function createInsertBar(groups: ReadonlyArray<readonly InsertItem[]>, end: readonly HTMLElement[] = []): { element: HTMLElement; refresh(): void } {
  const buttons: Array<{ button: HTMLButtonElement; item: InsertItem }> = [];
  const element = renderElement("div", { class: "dw-insertbar", role: "toolbar", "aria-label": "Insert" });
  for (const group of groups) {
    const section = renderElement("div", { class: "dw-insert-group" });
    for (const item of group) {
      const button = shellButton(item.icon, item.label, "dw-insert", (self) => {
        if (item.menu) showMenu(self, item.menu()); else item.run?.();
      });
      if (item.menu) button.insertAdjacentHTML("beforeend", renderIcon("chevron-down"));
      buttons.push({ button, item });
      section.append(button);
    }
    element.append(section);
  }
  element.append(renderElement("span", { class: "dw-spacer" }), ...end);
  const refresh = (): void => {
    for (const { button, item } of buttons) {
      const reason = item.disabled?.();
      button.disabled = reason !== undefined;
      button.title = reason ?? item.label;
    }
  };
  return { element, refresh };
}
