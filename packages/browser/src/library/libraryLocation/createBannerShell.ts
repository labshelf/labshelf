// Builds the frame shared by the storage banner and the move offer, and sets a button's icon and label.
import { renderIcon, type IconName } from "@labshelf/core";
import { renderElement } from "@labshelf/core/dom";

export interface BannerShell {
  root: HTMLElement;
  text: HTMLElement;
}

export function createBannerShell(tone: "warn" | "neutral", glyph: IconName): BannerShell {
  const text = renderElement("div", { class: "lsrc-text" });
  const root = renderElement("div", { class: `lsrc-banner ${tone}` }, renderElement("span", { class: "lsrc-icon", html: renderIcon(glyph) }), text);
  return { root, text };
}

/** Shows `label` beside `glyph`; a busy button is disabled and its icon spins. */
export function setButton(button: HTMLButtonElement, glyph: IconName, label: string, busy: boolean): void {
  button.disabled = busy;
  button.replaceChildren(
    renderElement("span", { class: busy ? "lsrc-spin" : "lsrc-glyph", html: renderIcon(busy ? "loader" : glyph) }),
    renderElement("span", { text: label }),
  );
}
