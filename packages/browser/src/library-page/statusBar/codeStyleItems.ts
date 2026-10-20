// Shows the source editor's code colours and font in the status bar, lets the user pick them and marks them on <html>.
import { CODE_FONT_NAMES, CODE_FONTS, CODE_THEME_NAMES, CODE_THEMES, icon, type IconName } from "@labshelf/core";
import { el, showMenu } from "@labshelf/core/dom";
import { PREFS_KEY, type PagePrefs } from "../prefs";

type CodeStyle = ReturnType<PagePrefs["codeStyle"]>;

function statusButton(title: string): HTMLButtonElement {
  return el("button", { class: "status-item clickable", type: "button", title });
}

function showLabel(button: HTMLButtonElement, glyph: IconName, label: string): void {
  button.innerHTML = icon(glyph);
  button.append(el("span", { text: label }));
}

function showPicker<T extends string>(
  anchor: HTMLElement, names: readonly T[], current: T, label: (name: T) => string, onPick: (name: T) => void,
): void {
  showMenu(anchor, names.map((name) => ({ label: label(name), checked: name === current, radio: true, onSelect: () => onPick(name) })));
}

/** Builds the two status items; the returned function stops following picks made in other tabs. */
export function mountCodeStyleItems(container: HTMLElement, prefs: PagePrefs): () => void {
  const themeItem = statusButton("Code colours");
  const fontItem = statusButton("Code font");
  const render = (): void => {
    const { codeTheme, codeFont } = prefs.codeStyle();
    document.documentElement.dataset["codeTheme"] = codeTheme;
    document.documentElement.dataset["codeFont"] = codeFont;
    showLabel(themeItem, "droplet", CODE_THEMES[codeTheme].label);
    showLabel(fontItem, "case-sensitive", CODE_FONTS[codeFont].label);
  };
  const pick = (codeStyle: Partial<CodeStyle>): void => { prefs.saveCodeStyle(codeStyle); render(); };
  themeItem.addEventListener("click", () => showPicker(themeItem, CODE_THEME_NAMES, prefs.codeStyle().codeTheme,
    (name) => CODE_THEMES[name].label, (codeTheme) => pick({ codeTheme })));
  fontItem.addEventListener("click", () => showPicker(fontItem, CODE_FONT_NAMES, prefs.codeStyle().codeFont,
    (name) => CODE_FONTS[name].label, (codeFont) => pick({ codeFont })));
  const onStorage = (e: StorageEvent): void => { if (e.key === PREFS_KEY) render(); };
  window.addEventListener("storage", onStorage);
  render();
  container.prepend(themeItem, fontItem);
  return () => window.removeEventListener("storage", onStorage);
}
