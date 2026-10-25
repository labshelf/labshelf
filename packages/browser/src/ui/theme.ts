// Holds the theme preference shared by every browser surface; follows the OS unless pinned light or dark.
// Stored in localStorage so themeStartup.ts applies it before paint; a storage event syncs open surfaces.
import { applyThemeToDocument, resolveTheme, type ResolvedTheme, type ThemePref } from "@labshelf/core/dom";

const THEME_STORAGE_KEY = "labshelf.theme";

const listeners = new Set<(theme: ResolvedTheme, pref: ThemePref) => void>();
let media: MediaQueryList | null = null;

/** Reads the stored preference, defaulting to "auto". */
export function readThemePref(): ThemePref {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return raw === "light" || raw === "dark" ? raw : "auto";
  } catch {
    return "auto";
  }
}

/** Applies the resolved theme to <html> and notifies subscribers. */
export function applyTheme(pref: ThemePref = readThemePref()): ResolvedTheme {
  const theme = resolveTheme(pref);
  applyThemeToDocument(theme);
  for (const cb of listeners) cb(theme, pref);
  return theme;
}

/** Persists a preference and applies it. */
export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === "auto") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch { /* private mode — apply for this page only */ }
  applyTheme(pref);
}

/** Subscribes to theme changes (OS, other surfaces, or this page). Fires immediately. */
export function onThemeChange(cb: (theme: ResolvedTheme, pref: ThemePref) => void): () => void {
  listeners.add(cb);
  cb(resolveTheme(readThemePref()), readThemePref());
  ensureWatchers();
  return () => { listeners.delete(cb); };
}

function ensureWatchers(): void {
  if (media) return;
  media = window.matchMedia("(prefers-color-scheme: light)");
  media.addEventListener("change", () => { if (readThemePref() === "auto") applyTheme("auto"); });
  window.addEventListener("storage", (e) => { if (e.key === THEME_STORAGE_KEY) applyTheme(); });
}
