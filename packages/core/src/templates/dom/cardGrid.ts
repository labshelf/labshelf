// Renders the visible templates as a keyboard-navigable card grid, its skeleton and empty states, and requests thumbnails for cards in view.
import { icon } from "../../ui/index.js";
import { el } from "../../ui/dom/index.js";
import type { TemplateKey } from "../protocol/index.js";
import type { TemplateEntry } from "../templateEntry.js";
import { keyOf, type GalleryState } from "./galleryState.js";
import { renderTemplateCard, type TemplateCard } from "./templateCard.js";

const MAX_BATCH = 200;
const SKELETON_COUNT = 3;

export interface CardGridHandlers {
  /** A card was activated by click or Enter. */
  onOpen(entry: TemplateEntry): void;
  /** Keys newly in view and not yet requested, in batches of at most 200. */
  onThumbnails(templates: TemplateKey[]): void;
}

export interface CardGrid {
  element: HTMLElement;
  /** Re-renders the cards or the state that replaces them from the gallery state. */
  update(): void;
  /** Stores the thumbnail in the state and patches that card in place (`undefined` keeps the placeholder). */
  setThumbnail(template: TemplateKey, dataUri: string | undefined): void;
  /** Moves focus to that template's card, if it is shown. */
  focusCard(template: TemplateKey): void;
  dispose(): void;
}

function skeletonCard(): HTMLElement {
  return el("li", { class: "ls-tpl-card is-loading", "aria-hidden": "true" },
    el("div", { class: "ls-tpl-thumb" }),
    el("div", { class: "ls-tpl-card-body" }, el("div", { class: "ls-tpl-card-name" }), el("div", { class: "ls-tpl-card-by" })));
}

function emptyState(text: string, hint: string): HTMLElement {
  return el("div", { class: "ls-empty" },
    el("div", { class: "ls-empty-icon", html: icon("grid") }),
    el("div", { class: "ls-empty-text", text }),
    el("div", { class: "ls-empty-hint", text: hint }));
}

function stateWithoutCards(state: GalleryState): HTMLElement[] {
  const statuses = state.statuses();
  if (statuses.includes("ready")) return [emptyState("No templates match these filters.", "Clear the search or pick another category.")];
  if (statuses.includes("loading")) return Array.from({ length: SKELETON_COUNT }, skeletonCard);
  return [emptyState("Templates could not be listed.", "Check the connection, then refresh.")];
}

function moveFocus(event: KeyboardEvent, buttons: HTMLElement[]): void {
  const current = buttons.findIndex((button) => button === event.target);
  if (current < 0) return;
  const top = buttons[0]!.parentElement!.offsetTop;
  const columns = Math.max(1, buttons.filter((button) => button.parentElement!.offsetTop === top).length);
  const target = { ArrowRight: current + 1, ArrowLeft: current - 1, ArrowDown: current + columns, ArrowUp: current - columns, Home: 0, End: buttons.length - 1 }[event.key];
  if (target === undefined) return;
  event.preventDefault();
  buttons[Math.max(0, Math.min(buttons.length - 1, target))]!.focus();
}

function showWithoutCards(state: GalleryState, list: HTMLElement, element: HTMLElement): void {
  const [first, ...rest] = stateWithoutCards(state);
  const skeletons = first!.classList.contains("ls-tpl-card");
  list.replaceChildren(...(skeletons ? [first!, ...rest] : []));
  if (!skeletons) element.append(first!);
}

interface ThumbnailRequester {
  /** The template each rendered card button stands for. */
  keys: Map<Element, TemplateKey>;
  observe(buttons: Element[]): void;
  dispose(): void;
}

function createThumbnailRequester(state: GalleryState, scrollRoot: HTMLElement, onThumbnails: CardGridHandlers["onThumbnails"]): ThumbnailRequester {
  const keys = new Map<Element, TemplateKey>();
  let observer: IntersectionObserver | undefined;
  const onIntersect = (hits: IntersectionObserverEntry[]): void => {
    const inView = hits.filter((hit) => hit.isIntersecting).flatMap((hit) => keys.get(hit.target) ?? []);
    const fresh = state.takeUnrequested(inView);
    for (let from = 0; from < fresh.length; from += MAX_BATCH) onThumbnails(fresh.slice(from, from + MAX_BATCH));
  };
  return {
    keys,
    observe(buttons) {
      observer?.disconnect();
      observer = new IntersectionObserver(onIntersect, { root: scrollRoot, rootMargin: "200px 0px" });
      for (const button of buttons) observer.observe(button);
    },
    dispose() { observer?.disconnect(); },
  };
}

function buildCards(state: GalleryState, entries: TemplateEntry[], handlers: CardGridHandlers, keys: Map<Element, TemplateKey>): Map<string, TemplateCard> {
  const cards = new Map<string, TemplateCard>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const card = renderTemplateCard(entry, state.thumbnails.get(key));
    card.button.addEventListener("click", () => handlers.onOpen(entry));
    cards.set(key, card);
    keys.set(card.button, { source: entry.source, id: entry.id });
  }
  return cards;
}

export function createCardGrid(state: GalleryState, scrollRoot: HTMLElement, handlers: CardGridHandlers): CardGrid {
  const list = el("ul", { class: "ls-tpl-grid", "aria-label": "Templates" });
  const element = el("div", { class: "ls-tpl-results" }, list);
  let cards = new Map<string, TemplateCard>();
  let tabbable: string | undefined;
  const thumbnails = createThumbnailRequester(state, scrollRoot, handlers.onThumbnails);

  const setTabbable = (key: string | undefined): void => {
    tabbable = key;
    for (const [cardKey, card] of cards) card.button.tabIndex = cardKey === key ? 0 : -1;
  };

  const renderCards = (entries: TemplateEntry[]): void => {
    thumbnails.keys.clear();
    cards = buildCards(state, entries, handlers, thumbnails.keys);
    list.replaceChildren(...[...cards.values()].map((card) => card.item));
    setTabbable(tabbable !== undefined && cards.has(tabbable) ? tabbable : cards.keys().next().value);
  };

  const update = (): void => {
    const entries = state.visible();
    element.querySelector(".ls-empty")?.remove();
    if (entries.length > 0) renderCards(entries);
    else {
      cards = new Map();
      thumbnails.keys.clear();
      showWithoutCards(state, list, element);
    }
    list.hidden = list.childElementCount === 0;
    thumbnails.observe([...cards.values()].map((card) => card.button));
  };

  list.addEventListener("focusin", (event) => {
    const key = [...cards].find(([, card]) => card.button === event.target)?.[0];
    if (key !== undefined) setTabbable(key);
  });
  list.addEventListener("keydown", (event) => moveFocus(event, [...cards.values()].map((card) => card.button)));

  return {
    element,
    update,
    setThumbnail(template, dataUri) {
      state.setThumbnail(template, dataUri);
      cards.get(keyOf(template))?.setThumbnail(dataUri);
    },
    focusCard: (template) => cards.get(keyOf(template))?.button.focus(),
    dispose: () => thumbnails.dispose(),
  };
}
