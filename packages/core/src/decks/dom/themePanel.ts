// Theme panel over the custom properties of theme.css's first :root rule, and the toolbar popover that holds a panel or a picker.
import { renderElement } from "../../ui/dom/index.js";
import { readThemeProperties } from "../themeCss.js";

export interface ThemePanelOptions { theme: string; onChange(name: string, value: string): void }

export interface PopoverContent { update?(): void; destroy(): void }

export interface ToolbarPopover { readonly element: HTMLElement; readonly button: HTMLButtonElement; refresh(): void; close(): void; destroy(): void }

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const EMPTY_TEXT = "theme.css has no custom properties in its :root rule.";

/** The value a colour input takes: `#rgb` expanded to `#rrggbb`, lower case. */
function colorValue(value: string): string {
  const hex = value.slice(1).toLowerCase();
  return `#${hex.length === 3 ? hex.replace(/./g, (digit) => digit + digit) : hex}`;
}

/** One entry per custom property name, in order of first appearance and with the last value. */
function propertyValues(theme: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const property of readThemeProperties(theme)) values.set(property.name, property.value.trim());
  return values;
}

export function mountThemePanel(host: HTMLElement, options: ThemePanelOptions): { readonly element: HTMLElement; update(theme: string): void; destroy(): void } {
  const element = renderElement("div", { class: "deck-editor-theme" });
  host.append(element);
  const render = (theme: string): void => {
    const rows = Array.from(propertyValues(theme), ([name, value]) => {
      const isColor = HEX_COLOR.test(value);
      const input = renderElement("input", { type: isColor ? "color" : "text", class: "deck-editor-theme-input", "aria-label": name });
      input.value = isColor ? colorValue(value) : value;
      input.addEventListener("change", () => {
        const next = input.value.trim();
        if (next !== "") options.onChange(name, next);
      });
      return renderElement("div", { class: "deck-editor-theme-row" }, renderElement("span", { class: "deck-editor-theme-name", text: name.slice(2) }), input);
    });
    element.replaceChildren(...(rows.length > 0 ? rows : [renderElement("p", { class: "deck-editor-theme-empty", text: EMPTY_TEXT })]));
  };
  render(options.theme);
  return { element, update: render, destroy: () => element.remove() };
}

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

/** The Theme toolbar button: its popover holds a theme panel that follows the current theme. */
export function createThemePopover(options: { theme(): string; onChange(name: string, value: string): void }): ToolbarPopover {
  return createToolbarPopover("Theme", "Edit the theme's custom properties", (pop) => {
    const panel = mountThemePanel(pop, { theme: options.theme(), onChange: options.onChange });
    return { update: () => panel.update(options.theme()), destroy: panel.destroy };
  });
}
