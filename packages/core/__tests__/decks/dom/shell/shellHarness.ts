// Spec 2.1: helpers shared by the tests of the generic deck shell core (shell.test.ts, shellStatusZoom.test.ts, shellKeysLayout.test.ts): DOM queries, a click and an icon check.
import { renderIcon } from "../../../../src/ui/dom/index.js";

export const q = <T extends Element = HTMLElement>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`not found: ${selector}`);
  return found;
};
export const byLabel = (root: ParentNode, label: string): HTMLButtonElement => q<HTMLButtonElement>(root, `[aria-label="${label}"]`);
export const click = (el: Element): void => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); };
export const text = (el: Element): string => (el.textContent ?? "").trim();
export const hasIcon = (el: Element, icon: Parameters<typeof renderIcon>[0]): boolean => {
  const holder = document.createElement("div");
  holder.innerHTML = renderIcon(icon);
  return el.innerHTML.includes(holder.innerHTML);
};
