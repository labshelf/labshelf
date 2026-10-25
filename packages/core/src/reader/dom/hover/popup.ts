/** Drives the #hover-popup element: fills it with a title, actions and body, places it next to its anchor and hides it. */
import { deriveClampedNumber, renderReaderIconButton } from "../elements/index.js";
import { renderIcon } from "../../../ui/index.js";
import type { PopupContent } from "./hoverAnchor.js";
import { findElement, renderElement } from "../../../ui/dom/index.js";

export function renderTextContent(texts: string[], jump: () => void): PopupContent {
  return { title: "Reference", body: renderElement("div", { class: "rd-hover-text" }, ...texts.map((t) => renderElement("p", {}, t))), copyText: texts.join("\n\n"), jump };
}

export class HoverPopup {
  private readonly el = findElement("hover-popup");

  onEnter(handler: () => void): void { this.el.addEventListener("mouseenter", handler); }

  onLeave(handler: () => void): void { this.el.addEventListener("mouseleave", handler); }

  contains(node: Node): boolean { return this.el.contains(node); }

  hide(): void {
    this.el.classList.remove("rd-visible");
    this.el.replaceChildren();
  }

  show(content: PopupContent, anchor: DOMRect, onCopy: (text: string) => void, onJump: () => void): void {
    const actions = renderElement("div", { class: "rd-hover-actions" });
    const { copyText } = content;
    if (copyText) {
      const copy = renderReaderIconButton(renderIcon("copy"), "Copy reference", "rd-btn-sm");
      copy.addEventListener("click", () => onCopy(copyText));
      actions.append(copy);
    }
    const go = renderReaderIconButton(renderIcon("arrow-right"), content.jumpLabel ?? "Jump to destination", "rd-btn-sm");
    go.addEventListener("click", onJump);
    actions.append(go);

    this.el.replaceChildren(...(content.bare ? [content.body] : [renderElement("div", { class: "rd-hover-header" }, renderElement("span", {}, content.title), actions), content.body]));
    this.el.classList.add("rd-visible");
    const p = this.el.getBoundingClientRect();
    const below = anchor.bottom + 8;
    const top = below + p.height <= window.innerHeight - 8 ? below : anchor.top - p.height - 8;
    this.el.style.top = `${deriveClampedNumber(top, 8, Math.max(8, window.innerHeight - p.height - 8))}px`;
    this.el.style.left = `${deriveClampedNumber(anchor.left + anchor.width / 2 - p.width / 2, 8, Math.max(8, window.innerWidth - p.width - 8))}px`;
  }
}
