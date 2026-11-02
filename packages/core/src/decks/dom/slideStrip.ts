// Slide strip: a listbox of slide thumbnails with select, drag and key reorder, add, duplicate and delete, each edit handed to the host.
import { renderElement } from "../../ui/dom/index.js";
import type { DeckEdit } from "../deckEdit.js";

/** The static copy shown for a slide whose thumbnail could not be rasterised: frames mount only for options in view. */
interface SlideStripFallback { size(): { width: number; height: number }; srcdoc(index: number): Promise<string | null> }

export interface SlideStripOptions { count: number; current: number; thumbnail(index: number): Promise<string | null>; onSelect(index: number): void; onEdit(edit: DeckEdit, label: string): void; fallback?: SlideStripFallback }

export interface SlideStrip { readonly element: HTMLElement; update(count: number, current: number): void; destroy(): void }

/** The width of a thumbnail in CSS px; deck-editor.css gives .deck-editor-strip-thumb the same width. */
const THUMB_WIDTH = 160;

interface Item {
  option: HTMLElement;
  thumb: HTMLElement;
  img: HTMLImageElement | null;
  box: HTMLElement | null;
  frame: HTMLIFrameElement | null;
  visible: boolean;
  token: number;
}

function actionButton(label: string, title: string, action: () => void): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: "ls-btn ls-btn-ghost deck-editor-strip-button", "aria-label": label, title, text: label });
  button.addEventListener("click", action);
  return button;
}

/** The live state of one mounted strip, shared by the functions below. */
interface StripState {
  readonly options: SlideStripOptions;
  readonly host: HTMLElement;
  readonly list: HTMLElement;
  readonly buttons: { add: HTMLButtonElement; duplicate: HTMLButtonElement; remove: HTMLButtonElement };
  readonly items: Item[];
  observer: IntersectionObserver | null;
  count: number;
  current: number;
  destroyed: boolean;
  dragFrom: number;
}

const edit = (s: StripState, change: DeckEdit, label: string): void => s.options.onEdit(change, label);
const addSlide = (s: StripState): void => edit(s, { kind: "addSlide", at: s.current + 1 }, "Add slide");
const duplicateSlide = (s: StripState): void => edit(s, { kind: "duplicateSlide", slide: s.current }, "Duplicate slide");
const deleteSlide = (s: StripState): void => {
  if (s.count > 1) edit(s, { kind: "deleteSlide", slide: s.current }, "Delete slide");
};
const move = (s: StripState, to: number, from: number = s.current): void => {
  if (to >= 0 && to < s.count && from >= 0 && from < s.count && to !== from) edit(s, { kind: "moveSlide", from, to }, "Move slide");
};
const select = (s: StripState, index: number): void => {
  if (index >= 0 && index < s.count) s.options.onSelect(index);
};

// ---- thumbnails ----

/** Fills the static frame of an option in view with the slide's srcdoc; a changed srcdoc replaces the old one. */
async function refreshFrame(s: StripState, item: Item): Promise<void> {
  const { fallback } = s.options;
  const index = s.items.indexOf(item);
  if (!item.frame || !fallback || index < 0) return;
  const token = item.token;
  let srcdoc: string | null = null;
  try {
    srcdoc = await fallback.srcdoc(index);
  } catch {
    srcdoc = null;
  }
  if (s.destroyed || s.items.indexOf(item) < 0 || item.token !== token || !item.frame || srcdoc === null) return;
  if (item.frame.getAttribute("srcdoc") !== srcdoc) item.frame.setAttribute("srcdoc", srcdoc);
}

function createObserver(s: StripState): IntersectionObserver | null {
  if (!s.options.fallback || typeof IntersectionObserver !== "function") return null;
  return new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const item = s.items.find((candidate) => candidate.box === entry.target);
      if (!item) continue;
      item.visible = entry.isIntersecting;
      if (item.visible) void refreshFrame(s, item);
    }
  });
}

function showImage(s: StripState, item: Item, index: number, url: string): void {
  if (item.box) {
    s.observer?.unobserve(item.box);
    item.box.remove();
    item.box = null;
    item.frame = null;
  }
  if (!item.img) {
    item.img = renderElement("img", { class: "deck-editor-strip-image", draggable: "false" });
    item.thumb.replaceChildren(item.img);
  }
  item.img.alt = `Slide ${index + 1}`;
  if (item.img.getAttribute("src") !== url) item.img.setAttribute("src", url);
}

function showFrame(s: StripState, item: Item): void {
  if (item.img) {
    item.img.remove();
    item.img = null;
  }
  if (!item.box) {
    item.frame = renderElement("iframe", { class: "deck-editor-strip-frame-view", sandbox: "allow-same-origin", tabindex: "-1", "aria-hidden": "true", title: "" });
    item.box = renderElement("div", { class: "deck-editor-strip-frame" }, item.frame);
    item.thumb.replaceChildren(item.box);
    if (s.observer) s.observer.observe(item.box);
  }
  const { fallback } = s.options;
  if (fallback) {
    const size = fallback.size();
    item.box.style.setProperty("--deck-editor-strip-scale", String(THUMB_WIDTH / size.width));
    item.box.style.aspectRatio = `${size.width} / ${size.height}`;
    item.frame!.style.width = `${size.width}px`;
    item.frame!.style.height = `${size.height}px`;
    if (item.visible) void refreshFrame(s, item);
  }
}

async function loadThumbnail(s: StripState, item: Item): Promise<void> {
  const token = ++item.token;
  let url: string | null = null;
  try {
    url = await s.options.thumbnail(s.items.indexOf(item));
  } catch {
    url = null;
  }
  const index = s.items.indexOf(item);
  if (s.destroyed || index < 0 || item.token !== token) return;
  if (url) showImage(s, item, index, url);
  else if (!s.options.fallback || s.observer) showFrame(s, item);
}

// ---- options ----

function bindDrag(s: StripState, item: Item): void {
  const { option } = item;
  option.addEventListener("dragstart", (event) => {
    s.dragFrom = s.items.indexOf(item);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(s.dragFrom + 1));
    }
  });
  option.addEventListener("dragover", (event) => {
    if (s.dragFrom < 0) return;
    event.preventDefault();
    option.classList.add("is-drop-target");
  });
  option.addEventListener("dragleave", () => option.classList.remove("is-drop-target"));
  option.addEventListener("drop", (event) => {
    event.preventDefault();
    option.classList.remove("is-drop-target");
    const from = s.dragFrom;
    s.dragFrom = -1;
    move(s, s.items.indexOf(item), from);
  });
  option.addEventListener("dragend", () => {
    s.dragFrom = -1;
    for (const entry of s.items) entry.option.classList.remove("is-drop-target");
  });
}

function createItem(s: StripState): Item {
  const thumb = renderElement("div", { class: "deck-editor-strip-thumb" });
  const number = renderElement("span", { class: "deck-editor-strip-number", "aria-hidden": "true" });
  const option = renderElement("div", { class: "deck-editor-strip-option", role: "option", draggable: "true" }, thumb, number);
  const item: Item = { option, thumb, img: null, box: null, frame: null, visible: !s.observer, token: 0 };
  option.addEventListener("click", () => select(s, s.items.indexOf(item)));
  bindDrag(s, item);
  return item;
}

function render(s: StripState): void {
  const { items, list } = s;
  const hadFocus = list.contains(s.host.ownerDocument.activeElement);
  while (items.length > s.count) {
    const item = items.pop()!;
    if (item.box) s.observer?.unobserve(item.box);
    item.option.remove();
  }
  while (items.length < s.count) {
    const item = createItem(s);
    items.push(item);
    list.append(item.option);
  }
  items.forEach((item, index) => {
    const selected = index === s.current;
    item.option.setAttribute("aria-selected", String(selected));
    item.option.setAttribute("aria-label", `Slide ${index + 1}`);
    item.option.tabIndex = selected ? 0 : -1;
    item.option.classList.toggle("is-current", selected);
    item.option.querySelector(".deck-editor-strip-number")!.textContent = String(index + 1);
  });
  s.buttons.duplicate.disabled = s.count === 0;
  s.buttons.remove.disabled = s.count <= 1;
  s.buttons.add.disabled = false;
  const active = items[s.current]?.option;
  if (hadFocus) active?.focus({ preventScroll: true });
  if (typeof active?.scrollIntoView === "function") active.scrollIntoView({ block: "nearest" });
  for (const item of items) void loadThumbnail(s, item);
}

// ---- keys ----

function onStripKey(s: StripState, event: KeyboardEvent): void {
  if (s.destroyed || !(event.target instanceof Node) || !s.list.contains(event.target)) return;
  if (event.metaKey || event.ctrlKey) {
    if (event.key.toLowerCase() !== "d" || event.altKey || event.shiftKey) return;
    event.preventDefault();
    duplicateSlide(s);
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const next = s.current + (event.key === "ArrowDown" ? 1 : -1);
    if (event.altKey) move(s, next);
    else select(s, next);
  } else if (event.key === "Delete" && !event.altKey && !event.shiftKey) {
    event.preventDefault();
    deleteSlide(s);
  }
}

export function mountSlideStrip(host: HTMLElement, options: SlideStripOptions): SlideStrip {
  const list = renderElement("div", { class: "deck-editor-strip-list", role: "listbox", "aria-label": "Slides", "aria-orientation": "vertical" });
  const add = actionButton("Add slide", "Add a slide after this one", () => addSlide(s));
  const duplicate = actionButton("Duplicate slide", "Duplicate this slide (Mod+D)", () => duplicateSlide(s));
  const remove = actionButton("Delete slide", "Delete this slide (Delete)", () => deleteSlide(s));
  const actions = renderElement("div", { class: "deck-editor-strip-actions", role: "group", "aria-label": "Slide actions" }, add, duplicate, remove);
  const element = renderElement("div", { class: "deck-editor-strip" }, list, actions);
  host.append(element);

  const s: StripState = {
    options, host, list, buttons: { add, duplicate, remove }, items: [], observer: null,
    count: options.count, current: options.current, destroyed: false, dragFrom: -1,
  };
  s.observer = createObserver(s);
  element.addEventListener("keydown", (event) => onStripKey(s, event));
  render(s);

  return {
    element,
    update(nextCount, nextCurrent) {
      if (s.destroyed) return;
      s.count = Math.max(0, Math.trunc(nextCount));
      s.current = nextCurrent;
      render(s);
    },
    destroy() {
      if (s.destroyed) return;
      s.destroyed = true;
      s.observer?.disconnect();
      element.remove();
    },
  };
}
