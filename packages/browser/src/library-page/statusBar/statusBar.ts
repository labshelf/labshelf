// Draws the bottom status bar like VS Code's: code colours and font, paper count, theme toggle and settings on the right.
import { icon } from "@labshelf/core";
import { $, el, type ThemePref } from "@labshelf/core/dom";
import { bx } from "../../platform";
import type { PagePrefs } from "../prefs";
import { cycleThemePref, onThemeChange } from "../../ui";
import { mountCodeStyleItems } from "./codeStyleItems";

const THEME_LABEL: Record<ThemePref, string> = { auto: "Theme: follows the system", light: "Theme: light", dark: "Theme: dark" };

/** Builds the status bar and appends it to `host`; `onPaperCount` subscribes to the library's paper count. */
export function mountStatusBar(
  host: HTMLElement, prefs: PagePrefs, onPaperCount: (listener: (count: number) => void) => () => void,
): () => void {
  const bar = el("footer", { class: "status-bar", html: `
    <div class="status-right">
      <span class="status-item" id="countItem"></span>
      <button class="status-item clickable" id="themeItem" type="button"></button>
      <button class="status-item clickable" id="settingsItem" type="button" title="LabShelf settings">${icon("gear")}</button>
    </div>` });
  host.append(bar);
  const themeItem = $<HTMLButtonElement>("themeItem", bar);
  themeItem.addEventListener("click", () => cycleThemePref());
  $("settingsItem", bar).addEventListener("click", () => { void bx.runtime.openOptionsPage(); });
  const offs = [
    mountCodeStyleItems(bar.querySelector<HTMLElement>(".status-right")!, prefs),
    onThemeChange((theme, pref) => {
      themeItem.innerHTML = icon(theme === "dark" ? "moon" : "sun");
      themeItem.title = `${THEME_LABEL[pref]} — click to change`;
    }),
    onPaperCount((count) => { $("countItem", bar).textContent = `${count} paper${count === 1 ? "" : "s"}`; }),
  ];
  return () => offs.forEach((off) => off());
}
