// Presenter mode (D9): the audience view (one scaled slide and a black cover) and the presenter view (current and next slide, notes, timer, buttons), synced through a PresenterChannel.
import { renderElement } from "../../ui/dom/index.js";
import { parseDeck, type DeckModel } from "../deckParse.js";
import { deckCanvasPx } from "../deckSizes.js";
import type { PresenterChannel, PresenterMessage } from "../presenterChannel.js";
import { createPresenterState, presenterKeyAction, reducePresenter, type PresenterAction, type PresenterState } from "../presenterState.js";
import { mountDeckFrame, type DeckFrame, type DeckFrameOptions } from "./deckFrame.js";
import { buildPresenterDom, fitSlide, mountSlide, nextStepOf, renderPresenter, showSlide, updatePresenterTime, type Shared, type SlideView } from "./presenterView.js";

export interface PresenterOptions { role: "audience" | "presenter"; html: string; theme: string; slide?: number; channel: PresenterChannel; resolveAsset: (path: string) => Promise<string>; loadMath?: DeckFrameOptions["loadMath"]; now?: () => number; requestFullscreen?: (element: HTMLElement) => Promise<void>; onExit?: () => void }

export interface PresenterController { state(): PresenterState; dispatch(action: PresenterAction): void; destroy(): void }

/** One slide drawn in a box: the element the view scales, the iframe whose keys it also reads (deck frames), and how it changes slide. */
export interface MountedSlide { element: HTMLElement; frame?: HTMLIFrameElement; setSlide(slide: number): void; destroy(): void }

/**
 * What a presenter shows: the slide count, the canvas size slides are drawn at, each slide's notes and label, the step the next box shows
 * after a slide (`nextOf`, slide + 1 when absent), and how a slide is mounted in a box.
 */
export interface PresenterSlideSource { count: number; canvas: { width: number; height: number }; notes(slide: number): string; label?(slide: number, count: number): string; nextOf?(slide: number): number; mount(box: HTMLElement, slide: number): MountedSlide }

/** The presenter options of any slide source: the deck-specific ones replaced by the source. */
export type SlidesPresenterOptions = Omit<PresenterOptions, "html" | "theme" | "resolveAsset" | "loadMath"> & { source: PresenterSlideSource };

const DEFAULT_CANVAS = { width: 1920, height: 1080 };

/** What a view draws on each state, and the boxes it fits. */
interface ViewParts { root: HTMLElement; slides: SlideView[]; render(state: PresenterState): void; destroy(): void }

/** The slide source of a deck: one deck frame per box, notes from the deck's notes elements. */
function deckSlideSource(options: PresenterOptions, model: DeckModel | undefined): PresenterSlideSource {
  const canvas = model?.size ? deckCanvasPx(model.size) : DEFAULT_CANVAS;
  return {
    count: Math.max(1, model?.slides.length ?? 0),
    canvas,
    notes: (slide) => model?.slides[slide]?.notes?.text.trim() ?? "",
    mount: (box, slide) => {
      const frame: DeckFrame = mountDeckFrame(box, { html: options.html, theme: options.theme, slide, resolveAsset: options.resolveAsset, ...(options.loadMath ? { loadMath: options.loadMath } : {}) });
      frame.frame.width = String(canvas.width);
      frame.frame.height = String(canvas.height);
      return { element: frame.frame, frame: frame.frame, setSlide: (next) => void frame.setSlide(next), destroy: () => frame.destroy() };
    },
  };
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
    destroy: () => slide.mounted.destroy(),
  };
}

function presenterView(host: HTMLElement, shared: Shared, initial: PresenterState, act: (action: PresenterAction) => void, current: () => PresenterState): ViewParts {
  const dom = buildPresenterDom(act, current);
  host.append(dom.root);
  const currentSlide = mountSlide(dom.currentBox, shared, initial.slide);
  const nextSlide = mountSlide(dom.nextBox, shared, Math.min(nextStepOf(shared.source, initial.slide), initial.count - 1));
  const updateTimer = (): void => updatePresenterTime(dom, current(), shared.now());
  const interval = window.setInterval(updateTimer, 1000);
  return {
    root: dom.root,
    slides: [currentSlide, nextSlide],
    render: (state) => renderPresenter(dom, { current: currentSlide, next: nextSlide }, shared, state, updateTimer),
    destroy: () => {
      window.clearInterval(interval);
      currentSlide.mounted.destroy();
      nextSlide.mounted.destroy();
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

/** The mutable run of one opened presenter or audience view. */
interface Session { presenting: boolean; destroyed: boolean; state: PresenterState; view: ViewParts | undefined; options: SlidesPresenterOptions; shared: Shared }

/** Applies an action: the presenter reduces it, renders and posts the state; the audience posts the action to the presenter. */
function actOn(session: Session, action: PresenterAction): void {
  if (session.destroyed) return;
  const { channel } = session.options;
  if (!session.presenting) {
    channel.post({ type: "action", action });
    return;
  }
  const next = reducePresenter(session.state, action, session.shared.now());
  if (next === session.state) return;
  session.state = next;
  session.view?.render(session.state);
  channel.post({ type: "state", state: session.state });
}

function keyHandler(session: Session): (event: KeyboardEvent) => void {
  const { options } = session;
  const leave = (): void => {
    options.channel.post({ type: "exit" });
    options.onExit?.();
  };
  return (event) => {
    if (session.destroyed || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
    const action = presenterKeyAction(event.key);
    if (!action) return;
    event.preventDefault();
    if (action === "exit") leave();
    else actOn(session, action);
  };
}

function messageHandler(session: Session): (message: PresenterMessage) => void {
  const { options, presenting } = session;
  return (message) => {
    if (session.destroyed) return;
    if (message.type === "exit") options.onExit?.();
    else if (presenting && message.type === "hello") options.channel.post({ type: "state", state: session.state });
    else if (presenting && message.type === "action") actOn(session, message.action);
    else if (!presenting && message.type === "state") {
      session.state = message.state;
      session.view?.render(session.state);
    }
  };
}

/** Listens for keys on the host document and each slide frame, channel messages and window resize; returns the removers. */
function listenSession(host: HTMLElement, session: Session, view: ViewParts): Array<() => void> {
  const onKey = keyHandler(session);
  const unlisteners = [
    listenKeys(host.ownerDocument, onKey),
    ...view.slides.flatMap((slide) => (slide.mounted.frame ? [listenFrameKeys(slide.mounted.frame, onKey)] : [])),
    session.options.channel.onMessage(messageHandler(session)),
  ];
  const win = host.ownerDocument.defaultView;
  const onResize = (): void => view.render(session.state);
  win?.addEventListener("resize", onResize);
  unlisteners.push(() => win?.removeEventListener("resize", onResize));
  return unlisteners;
}

/** Opens the audience or presenter view of a deck in host. The presenter owns the state; the audience renders what it receives. */
export function openPresenter(host: HTMLElement, options: PresenterOptions): PresenterController {
  const { html: _html, theme: _theme, resolveAsset: _resolve, loadMath: _math, ...rest } = options;
  return openSlidesPresenter(host, { ...rest, source: deckSlideSource(options, parseDeck(options.html).model) });
}

/** Opens the audience or presenter view of any slide source (a deck, a PDF) in host. */
export function openSlidesPresenter(host: HTMLElement, options: SlidesPresenterOptions): PresenterController {
  const { source } = options;
  const shared: Shared = { options, source, canvas: source.canvas, now: options.now ?? Date.now };
  const state = createPresenterState(Math.max(1, source.count), options.slide ?? 0);
  const session: Session = { presenting: options.role === "presenter", destroyed: false, state, view: undefined, options, shared };
  const act = (action: PresenterAction): void => actOn(session, action);
  const view = session.presenting ? presenterView(host, shared, state, act, () => session.state) : audienceView(host, shared, state);
  session.view = view;
  view.render(session.state);
  const unlisteners = listenSession(host, session, view);
  if (!session.presenting) {
    options.channel.post({ type: "hello" });
    try {
      options.requestFullscreen?.(view.root).catch(() => undefined);
    } catch {
      // full screen is a nicety: the audience view works in a window too
    }
  }

  return {
    state: () => session.state,
    dispatch: act,
    destroy: () => {
      if (session.destroyed) return;
      session.destroyed = true;
      for (const unlisten of unlisteners) unlisten();
      view.destroy();
      view.root.remove();
    },
  };
}

export * from "./pdfDeck.js";
