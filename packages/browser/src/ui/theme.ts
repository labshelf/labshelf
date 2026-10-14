/**
 * Theme preference shared by every browser surface. The page follows the OS unless the user pins light
 * or dark; the preference lives in localStorage so ui/themeBoot.ts applies it before paint, and a
 * storage event keeps every open surface in step.
 */
import { applyThemeToDocument, nextThemePref, resolveTheme, type ResolvedTheme, type ThemePref } from "@labshelf/core/dom";

export const THEME_STORAGE_KEY = "labshelf.theme";

const listeners = new Set<(theme: ResolvedTheme, pref: ThemePref) => void>();
let media: MediaQueryList | null = null;

/** Reads the stored preference, defaulting to "auto". */
export function getThemePref(): ThemePref {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return raw === "light" || raw === "dark" ? raw : "auto";
  } catch {
    return "auto";
  }
}

/** Applies the resolved theme to <html> and notifies subscribers. */
export function applyTheme(pref: ThemePref = getThemePref()): ResolvedTheme {
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

/** Advances the preference one step through the cycle, the way the status-bar toggle expects. */
export function cycleThemePref(): ThemePref {
  const pref = nextThemePref(getThemePref());
  setThemePref(pref);
  return pref;
}

/** Subscribes to theme changes (OS, other surfaces, or this page). Fires immediately. */
export function onThemeChange(cb: (theme: ResolvedTheme, pref: ThemePref) => void): () => void {
  listeners.add(cb);
  cb(resolveTheme(getThemePref()), getThemePref());
  ensureWatchers();
  return () => { listeners.delete(cb); };
}

function ensureWatchers(): void {
  if (media) return;
  media = window.matchMedia("(prefers-color-scheme: light)");
  media.addEventListener("change", () => { if (getThemePref() === "auto") applyTheme("auto"); });
  window.addEventListener("storage", (e) => { if (e.key === THEME_STORAGE_KEY) applyTheme(); });
}
