// Builds a pill with a member's initials, named for assistive technology by the full name.
import { renderElement } from "../../dom.js";

export function renderMemberChip(name: string): HTMLElement {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return renderElement("span", { class: "ls-member", role: "img", "aria-label": name, title: name, text: initials });
}
