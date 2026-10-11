/** The #hover-popup element: fills it with a title, actions and body, places it next to its anchor and hides it. */
import { byId, clamp, h, icon, iconButton } from "../elements/index.js";
import type { PopupContent } from "./hoverTarget.js";

export function textContent(texts: string[], jump: () => void): PopupContent {
  return { title: "Reference", body: h("div", { class: "rd-hover-text" }, ...texts.map((t) => h("p", {}, t))), copyText: texts.join("\n\n"), jump };
}

export class HoverPopup {
  private readonly el = byId("hover-popup");

  onEnter(handler: () => void): void { this.el.addEventListener("mouseenter", handler); }

  onLeave(handler: () => void): void { this.el.addEventListener("mouseleave", handler); }

  contains(node: Node): boolean { return this.el.contains(node); }

  hide(): void {
    this.el.classList.remove("rd-visible");
    this.el.replaceChildren();
  }

  show(content: PopupContent, anchor: DOMRect, onCopy: (text: string) => void, onJump: () => void): void {
    const actions = h("div", { class: "rd-hover-actions" });
    const { copyText } = content;
    if (copyText) {
      const copy = iconButton(icon("copy"), "Copy reference", "rd-btn-sm");
      copy.addEventListener("click", () => onCopy(copyText));
      actions.append(copy);
    }
    const go = iconButton(icon("arrow-right"), "Jump to destination", "rd-btn-sm");
    go.addEventListener("click", onJump);
    actions.append(go);

    this.el.replaceChildren(h("div", { class: "rd-hover-header" }, h("span", {}, content.title), actions), content.body);
    this.el.classList.add("rd-visible");
    const p = this.el.getBoundingClientRect();
    const below = anchor.bottom + 8;
    const top = below + p.height <= window.innerHeight - 8 ? below : anchor.top - p.height - 8;
    this.el.style.top = `${clamp(top, 8, Math.max(8, window.innerHeight - p.height - 8))}px`;
    this.el.style.left = `${clamp(anchor.left + anchor.width / 2 - p.width / 2, 8, Math.max(8, window.innerWidth - p.width - 8))}px`;
  }
}
