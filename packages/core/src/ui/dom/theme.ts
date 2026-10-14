/**
 * Storage-free theme logic for DOM surfaces: resolving "auto" against the OS colour scheme, writing the
 * result to <html data-theme> (where the design tokens read it), and the auto → light → dark cycle.
 */

export type ThemePref = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

/** Resolves a preference against the OS colour scheme. */
export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref !== "auto") return pref;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Sets the resolved theme on <html data-theme>. */
export function applyThemeToDocument(theme: ResolvedTheme): void {
  document.documentElement.dataset["theme"] = theme;
}

/** The preference after `pref` in the auto → light → dark → auto cycle. */
export function nextThemePref(pref: ThemePref): ThemePref {
  const next: Record<ThemePref, ThemePref> = { auto: "light", light: "dark", dark: "auto" };
  return next[pref];
}
