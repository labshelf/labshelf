// The presenter view's DOM (head with label, clock and timer, current and next slide, notes, buttons) and how it redraws for a state.
import { renderElement } from "../../ui/dom/index.js";
import { formatPresenterTime, presenterElapsedMs, type PresenterAction, type PresenterState } from "../presenterState.js";
import type { MountedSlide, PresenterSlideSource, SlidesPresenterOptions } from "./openPresenter.js";

/** One mounted slide in a box, scaled to fit the measured box (the host for the audience) by a CSSOM transform. */
export interface SlideView { box: HTMLElement; mounted: MountedSlide; slide: number }

/** What every view of one opened presenter shares: its options, slide source, canvas and clock. */
export interface Shared { options: SlidesPresenterOptions; source: PresenterSlideSource; canvas: { width: number; height: number }; now: () => number }

export function mountSlide(box: HTMLElement, shared: Shared, slide: number): SlideView {
  return { box, mounted: shared.source.mount(box, slide), slide };
}

export function showSlide(view: SlideView, slide: number): void {
  if (view.slide === slide) return;
  view.slide = slide;
  view.mounted.setSlide(slide);
}

/** Scales and centres the slide inside the measured element; nothing is written while it has no size. */
export function fitSlide(view: SlideView, measured: HTMLElement, canvas: { width: number; height: number }): void {
  const width = measured.clientWidth;
  const height = measured.clientHeight;
  if (width <= 0 || height <= 0) return;
  const scale = Math.min(width / canvas.width, height / canvas.height);
  const x = (width - canvas.width * scale) / 2;
  const y = (height - canvas.height * scale) / 2;
  const style = view.mounted.element.style;
  style.transformOrigin = "0 0";
  style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}

/** The step the next box shows after `slide`: the source's nextOf (a PDF skips overlay pages), else slide + 1. */
export const nextStepOf = (source: PresenterSlideSource, slide: number): number => source.nextOf?.(slide) ?? slide + 1;

export interface PresenterDom { root: HTMLElement; label: HTMLElement; clock: HTMLElement; timer: HTMLElement; currentBox: HTMLElement; nextBox: HTMLElement; end: HTMLElement; notes: HTMLElement; pause: HTMLButtonElement; black: HTMLButtonElement }

/** The presenter view's DOM: head (label, clock, timer), current and next slide boxes, notes and the control buttons. */
export function buildPresenterDom(act: (action: PresenterAction) => void, current: () => PresenterState): PresenterDom {
  const label = renderElement("span", { class: "ls-deck-presenter-label" });
  const clock = renderElement("span", { class: "ls-deck-presenter-clock", "aria-label": "Clock" });
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
    renderElement("div", { class: "ls-deck-presenter-head" }, label, clock, timer),
    renderElement("section", { class: "ls-deck-presenter-current", "aria-label": "Current slide" }, currentBox),
    renderElement("section", { class: "ls-deck-presenter-next", "aria-label": "Next slide" }, nextBox, end),
    notes, tools);
  return { root, label, clock, timer, currentBox, nextBox, end, notes, pause, black };
}

const twoDigits = (n: number): string => String(n).padStart(2, "0");

/** Writes the elapsed timer of a state and the wall clock (HH:MM, 24 h, local time) at `now`. */
export function updatePresenterTime(dom: PresenterDom, state: PresenterState, now: number): void {
  dom.timer.textContent = formatPresenterTime(presenterElapsedMs(state, now));
  const date = new Date(now);
  dom.clock.textContent = `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

/** Redraws the presenter view for a state: both slides, the end marker, label, notes, buttons and fit. */
export function renderPresenter(dom: PresenterDom, slides: { current: SlideView; next: SlideView }, shared: Shared, state: PresenterState, updateTimer: () => void): void {
  showSlide(slides.current, state.slide);
  const next = nextStepOf(shared.source, state.slide);
  const last = next >= state.count;
  if (!last) showSlide(slides.next, next);
  dom.nextBox.hidden = last;
  dom.end.hidden = !last;
  dom.label.textContent = shared.source.label?.(state.slide, state.count) ?? `Slide ${state.slide + 1} of ${state.count}`;
  dom.notes.textContent = shared.source.notes(state.slide) || "No notes";
  dom.pause.textContent = state.pausedAt === null ? "Pause" : "Resume";
  dom.black.setAttribute("aria-pressed", String(state.black));
  updateTimer();
  fitSlide(slides.current, dom.currentBox, shared.canvas);
  fitSlide(slides.next, dom.nextBox, shared.canvas);
}
