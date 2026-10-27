// Renders the visible templates as a keyboard-navigable card grid with its skeleton and empty states, one template as a card, and a template's detail page.
import { renderIcon } from "../../ui/index.js";
import { renderElement } from "../../ui/dom/index.js";
import type { TemplateAddress } from "../host/index.js";
import type { TemplateEntry } from "../templateCatalog.js";
import { CATEGORY_LABELS, formatDistinctEngineLabel, FORMAT_LABELS, formatTemplateByLine, formatTemplateMetaLine, formatTemplateUsesCount, formatTemplateUsesLabel } from "../templateLabels.js";
import { deriveTemplateAddress, type GalleryState } from "./galleryControls.js";

const MAX_BATCH = 200;
const SKELETON_COUNT = 3;

export interface CardGridHandlers {
  /** A card was activated by click or Enter. */
  onOpen(entry: TemplateEntry): void;
  /** Keys newly in view and not yet requested, in batches of at most 200. */
  onThumbnails(templates: TemplateAddress[]): void;
}

export interface CardGrid {
  element: HTMLElement;
  /** Re-renders the cards or the state that replaces them from the gallery state. */
  update(): void;
  /** Stores the thumbnail in the state and patches that card in place (`undefined` keeps the placeholder). */
  setThumbnail(template: TemplateAddress, dataUri: string | undefined): void;
  /** Moves focus to that template's card, if it is shown. */
  focusCard(template: TemplateAddress): void;
  dispose(): void;
}

function skeletonCard(): HTMLElement {
  return renderElement("li", { class: "ls-tpl-card is-loading", "aria-hidden": "true" },
    renderElement("div", { class: "ls-tpl-thumb" }),
    renderElement("div", { class: "ls-tpl-card-body" }, renderElement("div", { class: "ls-tpl-card-name" }), renderElement("div", { class: "ls-tpl-card-by" })));
}

function emptyState(text: string, hint: string): HTMLElement {
  return renderElement("div", { class: "ls-empty" },
    renderElement("div", { class: "ls-empty-icon", html: renderIcon("grid") }),
    renderElement("div", { class: "ls-empty-text", text }),
    renderElement("div", { class: "ls-empty-hint", text: hint }));
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
  keys: Map<Element, TemplateAddress>;
  observe(buttons: Element[]): void;
  dispose(): void;
}

function createThumbnailRequester(state: GalleryState, scrollRoot: HTMLElement, onThumbnails: CardGridHandlers["onThumbnails"]): ThumbnailRequester {
  const keys = new Map<Element, TemplateAddress>();
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

function buildCards(state: GalleryState, entries: TemplateEntry[], handlers: CardGridHandlers, keys: Map<Element, TemplateAddress>): Map<string, TemplateCard> {
  const cards = new Map<string, TemplateCard>();
  for (const entry of entries) {
    const key = deriveTemplateAddress(entry);
    const card = renderTemplateCard(entry, state.thumbnails.get(key));
    card.button.addEventListener("click", () => handlers.onOpen(entry));
    cards.set(key, card);
    keys.set(card.button, { source: entry.source, id: entry.id });
  }
  return cards;
}

export function createCardGrid(state: GalleryState, scrollRoot: HTMLElement, handlers: CardGridHandlers): CardGrid {
  const list = renderElement("ul", { class: "ls-tpl-grid", "aria-label": "Templates" });
  const element = renderElement("div", { class: "ls-tpl-results" }, list);
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
      cards.get(deriveTemplateAddress(template))?.setThumbnail(dataUri);
    },
    focusCard: (template) => cards.get(deriveTemplateAddress(template))?.button.focus(),
    dispose: () => thumbnails.dispose(),
  };
}

/** Fills a thumbnail box with the image, or with the placeholder icon when there is none. */
export function updateThumbnailBox(box: HTMLElement, dataUri: string | undefined, alt: string): void {
  if (dataUri === undefined) {
    box.replaceChildren(renderElement("span", { class: "ls-tpl-thumb-icon", html: renderIcon("file-text") }));
    return;
  }
  box.replaceChildren(renderElement("img", { src: dataUri, alt, loading: "lazy" }));
}

export interface TemplateCard {
  item: HTMLLIElement;
  button: HTMLButtonElement;
  setThumbnail(dataUri: string | undefined): void;
}

export function renderTemplateCard(entry: TemplateEntry, thumbnail: string | undefined): TemplateCard {
  const by = formatTemplateByLine(entry);
  const thumb = renderElement("div", { class: "ls-tpl-thumb" });
  const button = renderElement("button", { class: "ls-tpl-card", type: "button", "aria-label": entry.name, tabindex: -1 },
    thumb,
    renderElement("div", { class: "ls-tpl-card-body" },
      renderElement("div", { class: "ls-tpl-card-name", text: entry.name, title: entry.name }),
      renderElement("div", { class: "ls-tpl-card-by", text: by, title: by }),
      renderElement("div", { class: "ls-tpl-card-meta", text: [formatTemplateMetaLine(entry), formatTemplateUsesLabel(entry)].filter((part) => part !== undefined).join(" · ") })));
  const setThumbnail = (dataUri: string | undefined): void => updateThumbnailBox(thumb, dataUri, "");
  setThumbnail(thumbnail);
  return { item: renderElement("li", {}, button), button, setThumbnail };
}

export interface TemplatePageOptions {
  entry: TemplateEntry;
  thumbnail: string | undefined;
  problem: string | undefined;
  busy: boolean;
  onBack(): void;
  onUse(): void;
}

export interface TemplatePage {
  element: HTMLElement;
  setProblem(problem: string | undefined): void;
  setBusy(busy: boolean): void;
  setThumbnail(dataUri: string | undefined): void;
  focus(): void;
  dispose(): void;
}

let nextHeadingId = 0;

function metaRows(entry: TemplateEntry): Array<[string, string]> {
  const engine = formatDistinctEngineLabel(entry);
  const rows: Array<[string, string]> = [["Format", FORMAT_LABELS[entry.format]]];
  if (engine) rows.push(["Engine", engine]);
  rows.push(["Category", CATEGORY_LABELS[entry.category]], ["License", entry.license]);
  if (entry.version) rows.push(["Version", entry.version]);
  if (entry.compiler) rows.push(["Needs Typst", `${entry.compiler} or later`]);
  const uses = formatTemplateUsesCount(entry);
  if (uses !== undefined) rows.push(["Uses", uses]);
  return rows;
}

function renderMeta(entry: TemplateEntry): HTMLElement {
  const dl = renderElement("dl", { class: "ls-tpl-meta" });
  for (const [label, value] of metaRows(entry)) {
    dl.append(renderElement("dt", { text: label }), renderElement("dd", { text: value, title: value }));
  }
  return dl;
}

function orderedFiles(entry: TemplateEntry, files: string[]): string[] {
  const rest = files.filter((path) => path !== entry.main).sort();
  return files.includes(entry.main) ? [entry.main, ...rest] : rest;
}

function renderFiles(entry: TemplateEntry, files: string[]): HTMLElement {
  const list = renderElement("ul", { class: "ls-tpl-files", "aria-label": "Files" });
  for (const path of orderedFiles(entry, files)) {
    list.append(renderElement("li", {},
      renderElement("span", { class: "ls-tpl-file-icon", html: renderIcon(path.endsWith("/") ? "folder" : "file") }),
      renderElement("span", { class: "ls-tpl-file-path", text: path, title: path })));
  }
  return renderElement("div", { class: "ls-tpl-files-block" }, renderElement("div", { class: "ls-tpl-section", text: "Files" }), list);
}

function renderWarning(problem: string): HTMLElement {
  return renderElement("div", { class: "ls-tpl-engine", role: "note" },
    renderElement("span", { class: "ls-tpl-engine-icon", html: renderIcon("warning") }),
    renderElement("span", { text: problem }));
}

function fillUseButton(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
  if (busy) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
  button.replaceChildren(
    ...(busy ? [renderElement("span", { class: "spin", html: renderIcon("loader") })] : []),
    renderElement("span", { text: busy ? "Creating project…" : "Use template" }));
}

export function renderTemplatePage(options: TemplatePageOptions): TemplatePage {
  const { entry } = options;
  const by = formatTemplateByLine(entry);
  const headingId = `ls-tpl-detail-title-${nextHeadingId++}`;
  const heading = renderElement("h1", { id: headingId, class: "ls-tpl-detail-title", tabindex: -1, text: entry.name, title: entry.name });
  const back = renderElement("button", { class: "ls-btn", type: "button" }, renderElement("span", { html: renderIcon("arrow-left") }), "Templates");
  const preview = renderElement("figure", { class: "ls-tpl-preview" });
  const use = renderElement("button", { class: "ls-btn ls-btn-primary ls-btn-lg", type: "button" });
  const warningSlot = renderElement("div", { class: "ls-tpl-engine-slot" });
  back.addEventListener("click", options.onBack);
  use.addEventListener("click", options.onUse);

  const setThumbnail = (dataUri: string | undefined): void =>
    updateThumbnailBox(preview, dataUri, `First page of the ${entry.name} template`);
  const setProblem = (problem: string | undefined): void =>
    warningSlot.replaceChildren(...(problem ? [renderWarning(problem)] : []));
  const setBusy = (busy: boolean): void => fillUseButton(use, busy);
  setThumbnail(options.thumbnail);
  setProblem(options.problem);
  setBusy(options.busy);

  const info = renderElement("div", { class: "ls-tpl-info" },
    renderElement("div", { class: "ls-tpl-detail-heading" }, heading,
      renderElement("div", { class: "ls-tpl-card-by", text: by, title: by }),
      renderElement("p", { class: "ls-tpl-description", text: entry.description })),
    use, warningSlot, renderMeta(entry),
    entry.files ? renderFiles(entry, entry.files) : null);
  const element = renderElement("section", { class: "ls-tpl-detail", "aria-labelledby": headingId },
    renderElement("div", { class: "ls-tpl-detail-nav" }, back),
    renderElement("div", { class: "ls-tpl-detail-body" }, preview, info));

  return { element, setProblem, setBusy, setThumbnail, focus: () => heading.focus(), dispose: () => element.remove() };
}
