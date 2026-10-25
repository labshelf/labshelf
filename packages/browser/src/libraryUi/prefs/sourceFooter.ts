// Builds source appearance pickers beside the editor's comment action.
import { CODE_FONTS, CODE_FONT_NAMES, CODE_THEMES, CODE_THEME_NAMES, icon, type IconName } from "@labshelf/core";
import { el, showMenu } from "@labshelf/core/dom";
import { createLocalStoragePrefs } from "./localStoragePrefs";

function picker<T extends string>(title: string, glyph: IconName, names: readonly T[], current: () => T,
  label: (name: T) => string, pick: (name: T) => void): HTMLButtonElement {
  const button = el("button", { class: "ls-source-style", type: "button", title, "aria-label": title, "aria-haspopup": "menu" });
  button.innerHTML = icon(glyph);
  button.append(el("span", { text: label(current()) }));
  button.addEventListener("click", () => showMenu(button, names.map((name) => ({
    label: label(name), checked: current() === name, radio: true, onSelect: () => pick(name),
  }))));
  return button;
}

export function createSourceFooter(action: HTMLElement): { dom: HTMLElement; destroy(): void } {
  const prefs = createLocalStoragePrefs();
  const theme = picker("Code colours", "droplet", CODE_THEME_NAMES, () => prefs.codeStyle().codeTheme,
    (name) => CODE_THEMES[name].label, (codeTheme) => {
      prefs.saveCodeStyle({ codeTheme });
      document.documentElement.dataset["codeTheme"] = codeTheme;
    });
  const font = picker("Code font", "case-sensitive", CODE_FONT_NAMES, () => prefs.codeStyle().codeFont,
    (name) => CODE_FONTS[name].label, (codeFont) => {
      prefs.saveCodeStyle({ codeFont });
      document.documentElement.dataset["codeFont"] = codeFont;
    });
  const render = (): void => {
    const style = prefs.codeStyle();
    theme.querySelector("span")!.textContent = CODE_THEMES[style.codeTheme].label;
    font.querySelector("span")!.textContent = CODE_FONTS[style.codeFont].label;
  };
  const observer = new MutationObserver(render);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-code-theme", "data-code-font"] });
  const dom = el("div", { class: "ls-add-comment-panel" }, theme, font, action);
  return { dom, destroy: () => observer.disconnect() };
}
