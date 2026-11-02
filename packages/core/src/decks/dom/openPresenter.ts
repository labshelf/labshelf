// Presenter mode (D9): the audience view (one scaled slide and a black cover) and the presenter view (current and next slide, notes, timer, buttons), synced through a PresenterChannel.
import { renderElement } from "../../ui/dom/index.js";
import { parseDeck, type DeckModel } from "../deckParse.js";
import { deckCanvasPx } from "../deckSizes.js";
import type { PresenterChannel, PresenterMessage } from "../present/presenterChannel.js";
import { createPresenterState, formatPresenterTime, presenterElapsedMs, presenterKeyAction, reducePresenter, type PresenterAction, type PresenterState } from "../present/presenterState.js";
import { mountDeckFrame, type DeckFrame, type DeckFrameOptions } from "./deckFrame.js";

export interface PresenterOptions { role: "audience" | "presenter"; html: string; theme: string; slide?: number; channel: PresenterChannel; resolveAsset: (path: string) => Promise<string>; loadMath?: DeckFrameOptions["loadMath"]; now?: () => number; requestFullscreen?: (element: HTMLElement) => Promise<void>; onExit?: () => void }

export interface PresenterController { state(): PresenterState; dispatch(action: PresenterAction): void; destroy(): void }

const DEFAULT_CANVAS = { width: 1920, height: 1080 };

/** One deck frame in a box, scaled to fit the measured box (the host for the audience) by a CSSOM transform. */
interface SlideView { box: HTMLElement; frame: DeckFrame; slide: number }

/** What a view draws on each state, and the boxes it fits. */
interface ViewParts { root: HTMLElement; slides: SlideView[]; render(state: PresenterState): void; destroy(): void }

interface Shared { options: PresenterOptions; model: DeckModel | undefined; canvas: { width: number; height: number }; now: () => number }

function mountSlide(box: HTMLElement, shared: Shared, slide: number): SlideView {
  const { options, canvas } = shared;
  const frame = mountDeckFrame(box, { html: options.html, theme: options.theme, slide, resolveAsset: options.resolveAsset, ...(options.loadMath ? { loadMath: options.loadMath } : {}) });
  frame.frame.width = String(canvas.width);
  frame.frame.height = String(canvas.height);
  return { box, frame, slide };
}

function showSlide(view: SlideView, slide: number): void {
  if (view.slide === slide) return;
  view.slide = slide;
  void view.frame.setSlide(slide);
}

/** Scales and centres the frame inside the measured element; nothing is written while it has no size. */
function fitSlide(view: SlideView, measured: HTMLElement, canvas: { width: number; height: number }): void {
  const width = measured.clientWidth;
  const height = measured.clientHeight;
  if (width <= 0 || height <= 0) return;
  const scale = Math.min(width / canvas.width, height / canvas.height);
  const x = (width - canvas.width * scale) / 2;
  const y = (height - canvas.height * scale) / 2;
  const style = view.frame.frame.style;
  style.transformOrigin = "0 0";
  style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}

function audienceView(host: HTMLElement, shared: Shared, initial: PresenterState): ViewParts {
  const box = renderElement("div", { class: "ls-deck-present-stage" });
  const cover = renderElement("div", { class: "ls-deck-present-black", hidden: true, "aria-hidden": "true" });
  const root = renderElement("div", { class: "ls-deck-present", role: "region", "aria-label": "Presentation" }, box, cover);
  host.append(root);
  const slide = mountSlide(box, shared, initial.slide);
  return {
    root,
    slides: [slide],
    render: (state) => {
      showSlide(slide, state.slide);
      cover.hidden = !state.black;
      fitSlide(slide, host, shared.canvas);
    },
    destroy: () => slide.frame.destroy(),
  };
}

function notesText(model: DeckModel | undefined, slide: number): string {
  return model?.slides[slide]?.notes?.text.trim() || "No notes";
}

function presenterView(host: HTMLElement, shared: Shared, initial: PresenterState, act: (action: PresenterAction) => void, current: () => PresenterState): ViewParts {
  const label = renderElement("span", { class: "ls-deck-presenter-label" });
  const timer = renderElement("span", { class: "ls-deck-presenter-timer", "data-presenter-timer": true, role: "timer", "aria-label": "Elapsed time" });
  const currentBox = renderElement("div", { class: "ls-deck-presenter-slide" });
  const nextBox = renderElement("div", { class: "ls-deck-presenter-slide" });
  const end = renderElement("p", { class: "ls-deck-presenter-end", hidden: true, text: "End of presentation" });
  const notes = renderElement("div", { class: "ls-deck-presenter-notes", "data-presenter-notes": true, role: "region", "aria-label": "Notes" });
  const button = (text: string, action: () => PresenterAction): HTMLButtonElement => {
    const b = renderElement("button", { type: "button", class: "ls-deck-presenter-button", text });
    b.addEventListener("click", () => act(action()));
    return b;
  };
  const pause = button("Pause", () => (current().pausedAt === null ? { kind: "pauseTimer" } : { kind: "resumeTimer" }));
  const black = button("Black screen", () => ({ kind: "toggleBlack" }));
  const tools = renderElement("div", { class: "ls-deck-presenter-tools", role: "toolbar", "aria-label": "Presenter controls" },
    button("Previous", () => ({ kind: "previous" })), button("Next", () => ({ kind: "next" })), black, pause, button("Reset", () => ({ kind: "resetTimer" })));
  const root = renderElement("div", { class: "ls-deck-presenter" },
    renderElement("div", { class: "ls-deck-presenter-head" }, label, timer),
    renderElement("section", { class: "ls-deck-presenter-current", "aria-label": "Current slide" }, currentBox),
    renderElement("section", { class: "ls-deck-presenter-next", "aria-label": "Next slide" }, nextBox, end),
    notes, tools);
  host.append(root);
  const currentSlide = mountSlide(currentBox, shared, initial.slide);
  const nextSlide = mountSlide(nextBox, shared, Math.min(initial.slide + 1, initial.count - 1));
  const updateTimer = (): void => {
    timer.textContent = formatPresenterTime(presenterElapsedMs(current(), shared.now()));
  };
  const interval = window.setInterval(updateTimer, 1000);
  return {
    root,
    slides: [currentSlide, nextSlide],
    render: (state) => {
      showSlide(currentSlide, state.slide);
      const last = state.slide >= state.count - 1;
      if (!last) showSlide(nextSlide, state.slide + 1);
      nextBox.hidden = last;
      end.hidden = !last;
      label.textContent = `Slide ${state.slide + 1} of ${state.count}`;
      notes.textContent = notesText(shared.model, state.slide);
      pause.textContent = state.pausedAt === null ? "Pause" : "Resume";
      black.setAttribute("aria-pressed", String(state.black));
      updateTimer();
      fitSlide(currentSlide, currentBox, shared.canvas);
      fitSlide(nextSlide, nextBox, shared.canvas);
    },
    destroy: () => {
      window.clearInterval(interval);
      currentSlide.frame.destroy();
      nextSlide.frame.destroy();
    },
  };
}

/** Reads keydown on a document through presenterKeyAction; returns the remover. */
function listenKeys(doc: Document, onKey: (event: KeyboardEvent) => void): () => void {
  doc.addEventListener("keydown", onKey);
  return () => doc.removeEventListener("keydown", onKey);
}

/** Keeps the key listener on the frame's current document, which each srcdoc load replaces. */
function listenFrameKeys(frame: HTMLIFrameElement, onKey: (event: KeyboardEvent) => void): () => void {
  let unlisten: (() => void) | null = null;
  const bind = (): void => {
    unlisten?.();
    const doc = frame.contentDocument;
    unlisten = doc ? listenKeys(doc, onKey) : null;
  };
  bind();
  frame.addEventListener("load", bind);
  return () => {
    frame.removeEventListener("load", bind);
    unlisten?.();
  };
}

const isTypingTarget = (target: EventTarget | null): boolean => {
  const tag = (target as { tagName?: unknown } | null)?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
};

/** Opens the audience or presenter view of a deck in host. The presenter owns the state; the audience renders what it receives. */
export function openPresenter(host: HTMLElement, options: PresenterOptions): PresenterController {
  const model = parseDeck(options.html).model;
  const shared: Shared = { options, model, canvas: model?.size ? deckCanvasPx(model.size) : DEFAULT_CANVAS, now: options.now ?? Date.now };
  const presenting = options.role === "presenter";
  let state = createPresenterState(Math.max(1, model?.slides.length ?? 0), options.slide ?? 0);
  let destroyed = false;
  const { channel } = options;

  const leave = (): void => {
    channel.post({ type: "exit" });
    options.onExit?.();
  };
  const act = (action: PresenterAction): void => {
    if (destroyed) return;
    if (!presenting) {
      channel.post({ type: "action", action });
      return;
    }
    const next = reducePresenter(state, action, shared.now());
    if (next === state) return;
    state = next;
    view.render(state);
    channel.post({ type: "state", state });
  };
  const onKey = (event: KeyboardEvent): void => {
    if (destroyed || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
    const action = presenterKeyAction(event.key);
    if (!action) return;
    event.preventDefault();
    if (action === "exit") leave();
    else act(action);
  };
  const onMessage = (message: PresenterMessage): void => {
    if (destroyed) return;
    if (message.type === "exit") options.onExit?.();
    else if (presenting && message.type === "hello") channel.post({ type: "state", state });
    else if (presenting && message.type === "action") act(message.action);
    else if (!presenting && message.type === "state") {
      state = message.state;
      view.render(state);
    }
  };

  const view = presenting ? presenterView(host, shared, state, act, () => state) : audienceView(host, shared, state);
  view.render(state);
  const unlisteners = [
    listenKeys(host.ownerDocument, onKey),
    ...view.slides.map((slide) => listenFrameKeys(slide.frame.frame, onKey)),
    channel.onMessage(onMessage),
  ];
  const win = host.ownerDocument.defaultView;
  const onResize = (): void => view.render(state);
  win?.addEventListener("resize", onResize);
  unlisteners.push(() => win?.removeEventListener("resize", onResize));
  if (!presenting) {
    channel.post({ type: "hello" });
    try {
      options.requestFullscreen?.(view.root).catch(() => undefined);
    } catch {
      // full screen is a nicety: the audience view works in a window too
    }
  }

  return {
    state: () => state,
    dispatch: act,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      for (const unlisten of unlisteners) unlisten();
      view.destroy();
      view.root.remove();
    },
  };
}
