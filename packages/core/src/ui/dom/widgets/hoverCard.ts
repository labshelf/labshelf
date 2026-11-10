// Shows a small card under a toolbar control while the pointer rests on it or the keyboard focuses it: the control's name and what it does.
import { renderElement } from "../dom.js";

/** What the card says: the control's name, and a sentence on what pressing it does. */
export interface HoverCardContent {
  label: string;
  description?: string;
}

const SHOW_DELAY_MS = 450;
/** A card shown this recently makes the next one appear at once, so moving along a toolbar reads each control without waiting. */
const WARM_MS = 600;
const GAP_PX = 6;
const MARGIN_PX = 8;

let card: HTMLElement | undefined;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hiddenAt = 0;
let shownFor: HTMLElement | undefined;

function hide(): void {
  clearTimeout(showTimer);
  showTimer = undefined;
  if (card && !card.hidden) { card.hidden = true; hiddenAt = Date.now(); }
  shownFor = undefined;
}

function place(target: HTMLElement, element: HTMLElement): void {
  const box = target.getBoundingClientRect();
  const width = element.offsetWidth;
  const left = Math.min(Math.max(MARGIN_PX, box.left + box.width / 2 - width / 2), window.innerWidth - width - MARGIN_PX);
  const below = box.bottom + GAP_PX;
  // Above the control when the card would leave the viewport below it, as in a footer.
  const top = below + element.offsetHeight > window.innerHeight - MARGIN_PX ? box.top - GAP_PX - element.offsetHeight : below;
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
}

function show(target: HTMLElement, content: () => HoverCardContent): void {
  if (!target.isConnected) return;
  const { label, description } = content();
  card ??= target.ownerDocument.body.appendChild(renderElement("div", { class: "ls-hover-card", role: "tooltip", hidden: true }));
  if (!card.isConnected) target.ownerDocument.body.append(card);
  card.replaceChildren(
    renderElement("div", { class: "ls-hover-card-label", text: label }),
    ...(description ? [renderElement("div", { class: "ls-hover-card-description", text: description })] : []),
  );
  card.hidden = false;
  shownFor = target;
  place(target, card);
}

/**
 * Gives `target` a hover card in place of its native title tooltip; `content` is read each time, so a control whose label follows
 * its state (the PDF toggle) shows the current one. The description is also set as the control's accessible description.
 */
export function attachHoverCard(target: HTMLElement, content: () => HoverCardContent): void {
  target.removeAttribute("title");
  const { description } = content();
  if (description) target.setAttribute("aria-description", description);
  const schedule = (): void => {
    clearTimeout(showTimer);
    if (Date.now() - hiddenAt < WARM_MS) { show(target, content); return; }
    showTimer = setTimeout(() => show(target, content), SHOW_DELAY_MS);
  };
  const leave = (): void => { if (shownFor === target || showTimer !== undefined) hide(); };
  target.addEventListener("mouseenter", schedule);
  target.addEventListener("mouseleave", leave);
  target.addEventListener("focus", () => { if (target.matches(":focus-visible")) schedule(); });
  target.addEventListener("blur", leave);
  // A press hides the card: a menu or dialog it opens takes the place below the control.
  target.addEventListener("pointerdown", hide);
  target.addEventListener("keydown", (event) => { if (event.key === "Escape") hide(); });
}
