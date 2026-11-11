// Reads the site theme, which follows the OS through prefers-color-scheme, and reports its changes to the demos.
import type { EffectiveTheme } from "@labshelf/core";

const prefersLight = matchMedia("(prefers-color-scheme: light)");

export function siteTheme(): EffectiveTheme {
  return prefersLight.matches ? "light" : "dark";
}

export function onSiteThemeChange(fn: (theme: EffectiveTheme) => void): void {
  prefersLight.addEventListener("change", () => fn(siteTheme()));
}
