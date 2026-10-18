// Builds the frame shared by the storage banner and the move offer, and sets a button's icon and label.
import { icon, type IconName } from "@labshelf/core";
import { el } from "@labshelf/core/dom";

export interface BannerShell {
  root: HTMLElement;
  text: HTMLElement;
}

export function bannerShell(tone: "warn" | "neutral", glyph: IconName): BannerShell {
  const text = el("div", { class: "lsrc-text" });
  const root = el("div", { class: `lsrc-banner ${tone}` }, el("span", { class: "lsrc-icon", html: icon(glyph) }), text);
  return { root, text };
}

/** Shows `label` beside `glyph`; a busy button is disabled and its icon spins. */
export function setButton(button: HTMLButtonElement, glyph: IconName, label: string, busy: boolean): void {
  button.disabled = busy;
  button.replaceChildren(
    el("span", { class: busy ? "lsrc-spin" : "lsrc-glyph", html: icon(busy ? "loader" : glyph) }),
    el("span", { text: label }),
  );
}
