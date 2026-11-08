// The deck editor's ghost toolbar button and the toolbar popover that holds a picker.
import { renderElement } from "../../ui/dom/index.js";

export interface PopoverContent { update?(): void; destroy(): void }

export interface ToolbarPopover { readonly element: HTMLElement; readonly button: HTMLButtonElement; refresh(): void; close(): void; destroy(): void }

/** A ghost toolbar button named `label`. */
export function createToolButton(label: string, title: string, action?: () => void): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: "ls-btn ls-btn-ghost deck-editor-tool", "aria-label": label, title, text: label });
  if (action) button.addEventListener("click", action);
  return button;
}

/** A toolbar button that opens a popover holding `mount`'s content while open; Escape and a press outside close it. */
export function createToolbarPopover(label: string, title: string, mount: (host: HTMLElement) => PopoverContent): ToolbarPopover {
  const button = createToolButton(label, title);
  button.setAttribute("aria-haspopup", "true");
  button.setAttribute("aria-expanded", "false");
  const pop = renderElement("div", { class: "deck-editor-popover", role: "group", "aria-label": label });
  pop.hidden = true;
  const element = renderElement("span", { class: "deck-editor-popover-anchor" }, button, pop);
  let content: PopoverContent | null = null;
  const onOutside = (event: Event): void => {
    if (!(event.target instanceof Node && element.contains(event.target))) close();
  };
  function close(): void {
    if (!content) return;
    content.destroy();
    content = null;
    pop.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
  }
  button.addEventListener("click", () => {
    if (content) return close();
    content = mount(pop);
    pop.hidden = false;
    button.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onOutside, true);
  });
  // Keys typed in the popover are the popover's: the editor's undo and nudge keys must not see them.
  element.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key !== "Escape" || !content) return;
    close();
    button.focus();
  });
  return { element, button, refresh: () => content?.update?.(), close, destroy: close };
}
