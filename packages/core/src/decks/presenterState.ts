// Presenter state (D9): slide index, black screen and elapsed timer, changed only through reducePresenter; time comes in as `now`.

export interface PresenterState { slide: number; count: number; black: boolean; startedAt: number | null; pausedAt: number | null; pausedTotal: number }

export type PresenterAction = { kind: "next" } | { kind: "previous" } | { kind: "first" } | { kind: "last" } | { kind: "goto"; slide: number } | { kind: "toggleBlack" } | { kind: "pauseTimer" } | { kind: "resumeTimer" } | { kind: "resetTimer" };

const clampSlide = (slide: number, count: number): number => Math.min(Math.max(slide, 0), count - 1);

/** A presenter state at slide (clamped to the deck), not black, timer stopped; count must be an integer >= 1. */
export function createPresenterState(count: number, slide = 0): PresenterState {
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`A deck has at least one slide (got ${count})`);
  return { slide: clampSlide(Number.isFinite(slide) ? Math.floor(slide) : 0, count), count, black: false, startedAt: null, pausedAt: null, pausedTotal: 0 };
}

/** Moves to target (clamped); any move clears black, and a move that changes the slide starts a stopped timer. */
function moveTo(state: PresenterState, target: number, now: number): PresenterState {
  const slide = clampSlide(target, state.count);
  if (slide === state.slide && !state.black) return state;
  const startedAt = slide !== state.slide && state.startedAt === null ? now : state.startedAt;
  return { ...state, slide, black: false, startedAt };
}

/** The state after one action at time now; the same object when the action changes nothing. */
export function reducePresenter(state: PresenterState, action: PresenterAction, now: number): PresenterState {
  switch (action.kind) {
    case "next": return moveTo(state, state.slide + 1, now);
    case "previous": return moveTo(state, state.slide - 1, now);
    case "first": return moveTo(state, 0, now);
    case "last": return moveTo(state, state.count - 1, now);
    case "goto": return Number.isInteger(action.slide) ? moveTo(state, action.slide, now) : state;
    case "toggleBlack": return { ...state, black: !state.black };
    case "pauseTimer": return state.startedAt === null || state.pausedAt !== null ? state : { ...state, pausedAt: now };
    case "resumeTimer": return state.pausedAt === null ? state : { ...state, pausedAt: null, pausedTotal: state.pausedTotal + (now - state.pausedAt) };
    case "resetTimer": return state.startedAt === null && state.pausedAt === null && state.pausedTotal === 0 ? state : { ...state, startedAt: null, pausedAt: null, pausedTotal: 0 };
  }
}

/** Elapsed presenting time in ms: 0 before the start, frozen while paused, never below 0. */
export function presenterElapsedMs(state: PresenterState, now: number): number {
  if (state.startedAt === null) return 0;
  return Math.max(0, (state.pausedAt ?? now) - state.startedAt - state.pausedTotal);
}

/** `m:ss` below one hour, `h:mm:ss` from one hour, in whole seconds. */
export function formatPresenterTime(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

const KEY_ACTIONS: ReadonlyMap<string, PresenterAction> = new Map(Object.entries({
  ArrowRight: { kind: "next" }, ArrowDown: { kind: "next" }, " ": { kind: "next" }, PageDown: { kind: "next" },
  ArrowLeft: { kind: "previous" }, ArrowUp: { kind: "previous" }, PageUp: { kind: "previous" },
  Home: { kind: "first" }, End: { kind: "last" }, b: { kind: "toggleBlack" }, B: { kind: "toggleBlack" },
} satisfies Record<string, PresenterAction>));

/** The D9 action of a KeyboardEvent.key value, "exit" for Escape, null for any other key. */
export function presenterKeyAction(key: string): PresenterAction | "exit" | null {
  if (key === "Escape") return "exit";
  const action = KEY_ACTIONS.get(key);
  return action ? { ...action } : null;
}
