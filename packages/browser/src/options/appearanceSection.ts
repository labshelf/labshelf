/** The Appearance section: the theme preference shared by every browser surface, as a segmented control. */
import { icon, type IconName } from "@labshelf/core";
import { el, settingRow, settingsSection, type ThemePref } from "@labshelf/core/dom";
import { getThemePref, onThemeChange, setThemePref } from "../ui";

const THEME_OPTIONS: Array<[ThemePref, string, IconName]> = [["auto", "System", "globe"], ["light", "Light", "sun"], ["dark", "Dark", "moon"]];

/** `onPicked` runs after the user picks a theme, e.g. to flash the "Saved" flag. */
export function createAppearanceSection(onPicked: () => void): HTMLElement {
  const seg = el("div", { class: "settings-seg", role: "radiogroup", "aria-label": "Theme" });
  const render = (current: ThemePref): void => {
    seg.replaceChildren(...THEME_OPTIONS.map(([pref, label, glyph]) => {
      const button = el("button", {
        class: current === pref ? "on" : "", type: "button", role: "radio", "aria-checked": String(current === pref), html: icon(glyph),
      });
      button.append(el("span", { text: label }));
      button.addEventListener("click", () => { setThemePref(pref); onPicked(); });
      return button;
    }));
  };
  onThemeChange((_theme, pref) => render(pref));
  render(getThemePref());
  return settingsSection(
    { title: "Appearance" },
    settingRow({ label: "Theme", description: "The library, popup and this page follow the system by default." }, seg),
  );
}
