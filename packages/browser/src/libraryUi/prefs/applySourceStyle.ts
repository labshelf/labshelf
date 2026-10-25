// Applies saved source colours and typography across open extension pages.
import { PREFS_KEY, type PagePrefs } from "./localStoragePrefs";

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
