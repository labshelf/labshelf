// The small card a computed math element shows on hover or focus (D12): an equation's Solve action and a result's state with Recompute.
import { renderElement } from "../../ui/dom/index.js";

export interface MathHoverCard {
  /** Builds the card's content and shows it under the anchor; no content hides it. */
  show(): void;
  hide(): void;
  /** Rebuilds the content of a shown card, after the state it reads changed. */
  refresh(): void;
  /** Whether `target` is inside the card, so the node view stops ProseMirror from handling the event. */
  contains(target: EventTarget | null): boolean;
  destroy(): void;
}

const HIDE_DELAY_MS = 150;

/** Listens on the anchor for what shows, schedules the hiding of and closes the card; returns the function that removes the listeners. */
function bindCardEvents(anchor: HTMLElement, card: HTMLElement, on: { show(): void; hide(): void; onLeave(): void }): () => void {
  const { show, hide, onLeave } = on;
  const onFocusOut = (event: FocusEvent): void => {
    if (!(event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget))) hide();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || card.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    hide();
  };
  anchor.addEventListener("mouseenter", show);
  anchor.addEventListener("focusin", show);
  anchor.addEventListener("mouseleave", onLeave);
  anchor.addEventListener("focusout", onFocusOut);
  anchor.addEventListener("keydown", onKey);
  return () => {
    anchor.removeEventListener("mouseenter", show);
    anchor.removeEventListener("focusin", show);
    anchor.removeEventListener("mouseleave", onLeave);
    anchor.removeEventListener("focusout", onFocusOut);
    anchor.removeEventListener("keydown", onKey);
  };
}

/**
 * Attaches a card to `anchor` (a node view's dom) shown while the pointer is over it or focus is in it, and closed by leaving it,
 * moving focus out or Escape. The card sits inside the anchor, so Tab reaches its buttons right after the anchor; `build` returns
 * the card's content when shown, or null when there is nothing to offer.
 */
export function attachMathHoverCard(anchor: HTMLElement, label: string, build: () => Array<HTMLElement | string> | null): MathHoverCard {
  const card = renderElement("span", { class: "qmd-math-card", contenteditable: "false", role: "group", "aria-label": label, hidden: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelHide = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const hide = (): void => {
    cancelHide();
    card.hidden = true;
    card.replaceChildren();
    card.remove();
  };
  const show = (): void => {
    cancelHide();
    const content = build();
    if (!content || content.length === 0) { hide(); return; }
    card.replaceChildren(...content);
    card.hidden = false;
    if (card.parentNode !== anchor) anchor.append(card);
  };
  const onLeave = (): void => {
    if (anchor.contains(anchor.ownerDocument.activeElement)) return;
    cancelHide();
    timer = setTimeout(hide, HIDE_DELAY_MS);
  };
  const unbind = bindCardEvents(anchor, card, { show, hide, onLeave });
  return {
    show,
    hide,
    refresh() { if (!card.hidden) show(); },
    contains: (target) => target instanceof Node && card.contains(target),
    destroy() {
      hide();
      unbind();
    },
  };
}

/** A text button of the card. */
export function renderCardAction(text: string, onClick: () => void): HTMLButtonElement {
  const button = renderElement("button", { class: "qmd-math-card-action", type: "button", text });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}
