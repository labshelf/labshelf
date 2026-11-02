// Presenter mode (D9): the audience view (one scaled slide and a black cover) and the presenter view (current and next slide, notes, timer, buttons), synced through a PresenterChannel.
import { renderElement } from "../../ui/dom/index.js";
import { parseDeck, type DeckModel } from "../deckParse.js";
import { deckCanvasPx } from "../deckSizes.js";
import type { PresenterChannel, PresenterMessage } from "../presenterChannel.js";
import { createPresenterState, formatPresenterTime, presenterElapsedMs, presenterKeyAction, reducePresenter, type PresenterAction, type PresenterState } from "../presenterState.js";
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

interface PresenterDom { root: HTMLElement; label: HTMLElement; timer: HTMLElement; currentBox: HTMLElement; nextBox: HTMLElement; end: HTMLElement; notes: HTMLElement; pause: HTMLButtonElement; black: HTMLButtonElement }

/** The presenter view's DOM: head (label, timer), current and next slide boxes, notes and the control buttons. */
function buildPresenterDom(act: (action: PresenterAction) => void, current: () => PresenterState): PresenterDom {
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
  return { root, label, timer, currentBox, nextBox, end, notes, pause, black };
}

/** Redraws the presenter view for a state: both slides, the end marker, label, notes, buttons and fit. */
function renderPresenter(dom: PresenterDom, slides: { current: SlideView; next: SlideView }, shared: Shared, state: PresenterState, updateTimer: () => void): void {
  showSlide(slides.current, state.slide);
  const last = state.slide >= state.count - 1;
  if (!last) showSlide(slides.next, state.slide + 1);
  dom.nextBox.hidden = last;
  dom.end.hidden = !last;
  dom.label.textContent = `Slide ${state.slide + 1} of ${state.count}`;
  dom.notes.textContent = notesText(shared.model, state.slide);
  dom.pause.textContent = state.pausedAt === null ? "Pause" : "Resume";
  dom.black.setAttribute("aria-pressed", String(state.black));
  updateTimer();
  fitSlide(slides.current, dom.currentBox, shared.canvas);
  fitSlide(slides.next, dom.nextBox, shared.canvas);
}

function presenterView(host: HTMLElement, shared: Shared, initial: PresenterState, act: (action: PresenterAction) => void, current: () => PresenterState): ViewParts {
  const dom = buildPresenterDom(act, current);
  host.append(dom.root);
  const currentSlide = mountSlide(dom.currentBox, shared, initial.slide);
  const nextSlide = mountSlide(dom.nextBox, shared, Math.min(initial.slide + 1, initial.count - 1));
  const updateTimer = (): void => {
    dom.timer.textContent = formatPresenterTime(presenterElapsedMs(current(), shared.now()));
  };
  const interval = window.setInterval(updateTimer, 1000);
  return {
    root: dom.root,
    slides: [currentSlide, nextSlide],
    render: (state) => renderPresenter(dom, { current: currentSlide, next: nextSlide }, shared, state, updateTimer),
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

/** The mutable run of one opened presenter or audience view. */
interface Session { presenting: boolean; destroyed: boolean; state: PresenterState; view: ViewParts | undefined; options: PresenterOptions; shared: Shared }

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
    ...view.slides.map((slide) => listenFrameKeys(slide.frame.frame, onKey)),
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
  const model = parseDeck(options.html).model;
  const shared: Shared = { options, model, canvas: model?.size ? deckCanvasPx(model.size) : DEFAULT_CANVAS, now: options.now ?? Date.now };
  const state = createPresenterState(Math.max(1, model?.slides.length ?? 0), options.slide ?? 0);
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
