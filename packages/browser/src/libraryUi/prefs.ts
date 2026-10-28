// Persists browser workspace preferences in localStorage, applies the saved source colours and typography across open extension pages, and builds the source appearance pickers beside the editor's comment action.
import {
  CODE_FONTS, CODE_FONT_NAMES, CODE_THEMES, CODE_THEME_NAMES, deriveCodeStyle, deriveDetailPane, deriveEditorWidth, deriveStringList, mergePrefs, normalizePrefs, parseStoredPrefs, renderIcon,
  type CodeStyle, type DetailPanePrefs, type IconName, type LibraryUiPrefs, type PrefsPort,
} from "@labshelf/core";
import { renderElement, showMenu } from "@labshelf/core/dom";

// ---- localStorage prefs
export const PREFS_KEY = "labshelf.library.prefs";

type PrefsStorage = Pick<Storage, "getItem" | "setItem">;

export interface PagePrefs extends PrefsPort {
  treeExpanded(): string[];
  saveTreeExpanded(paths: string[]): void;
  collapsedSections(): string[];
  saveCollapsedSections(ids: string[]): void;
  /** The first editor group's width in pixels while two groups show; null until the user drags the sash. */
  editorWidth(): number | null;
  saveEditorWidth(width: number): void;
  detailPane(): DetailPanePrefs;
  saveDetailPane(patch: Partial<DetailPanePrefs>): void;
  codeStyle(): CodeStyle;
  saveCodeStyle(patch: Partial<CodeStyle>): void;
}

function readRaw(storage: PrefsStorage): Record<string, unknown> {
  return parseStoredPrefs(storage.getItem(PREFS_KEY));
}

export function createLocalStoragePrefs(storage: PrefsStorage = localStorage): PagePrefs {
  const write = (patch: Record<string, unknown>): void => {
    const next = mergePrefs(readRaw(storage), patch);
    // Private windows can refuse writes; the page then works with the in-memory state only.
    try { storage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  return {
    load: () => normalizePrefs(readRaw(storage)),
    save: (patch: Partial<LibraryUiPrefs>) => write(patch),
    treeExpanded: () => deriveStringList(readRaw(storage), "treeExpanded"),
    saveTreeExpanded: (paths) => write({ treeExpanded: paths }),
    collapsedSections: () => deriveStringList(readRaw(storage), "collapsedSections"),
    saveCollapsedSections: (ids) => write({ collapsedSections: ids }),
    editorWidth: () => deriveEditorWidth(readRaw(storage)),
    saveEditorWidth: (width) => write({ editorWidth: width }),
    detailPane: () => deriveDetailPane(readRaw(storage)),
    saveDetailPane: (patch) => write(patch),
    codeStyle: () => deriveCodeStyle(readRaw(storage)),
    saveCodeStyle: (patch) => write(patch),
  };
}

// ---- Applying the code style
export function applyCodeStyle(prefs: PagePrefs): () => void {
  const render = (): void => {
    const { codeTheme, codeFont } = prefs.codeStyle();
    document.documentElement.dataset["codeTheme"] = codeTheme;
    document.documentElement.dataset["codeFont"] = codeFont;
  };
  const onStorage = (event: StorageEvent): void => {
    if (event.key === PREFS_KEY || event.key === null) render();
  };
  render();
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

// ---- Source footer
function picker<T extends string>(title: string, glyph: IconName, names: readonly T[], current: () => T,
  label: (name: T) => string, pick: (name: T) => void): HTMLButtonElement {
  const button = renderElement("button", { class: "ls-source-style", type: "button", title, "aria-label": title, "aria-haspopup": "menu" });
  button.innerHTML = renderIcon(glyph);
  button.append(renderElement("span", { text: label(current()) }));
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
  const dom = renderElement("div", { class: "ls-add-comment-panel" }, theme, font, action);
  return { dom, destroy: () => observer.disconnect() };
}
