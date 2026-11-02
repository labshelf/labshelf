/**
 * Spec 7.1: the pure presenter state. createPresenterState and reducePresenter (slide moves, black screen, timer), presenterElapsedMs,
 * formatPresenterTime and presenterKeyAction. Time is passed in as `now`; no clock is read.
 */
import {
  createPresenterState,
  formatPresenterTime,
  presenterElapsedMs,
  presenterKeyAction,
  reducePresenter,
  type PresenterAction,
  type PresenterState,
} from "../../src/decks/presenterState";

const run = (state: PresenterState, actions: PresenterAction[], now = 0): PresenterState => actions.reduce((s, a) => reducePresenter(s, a, now), state);

// --- 7.1a ---------------------------------------------------------------------------------------------------------------------------

describe("createPresenterState", () => {
  it("7.1a starts at slide 0 with no black screen and a stopped timer", () => {
    expect(createPresenterState(5)).toEqual({ slide: 0, count: 5, black: false, startedAt: null, pausedAt: null, pausedTotal: 0 });
  });

  it("7.1a clamps the starting slide to 0..count-1", () => {
    expect(createPresenterState(3, 1).slide).toBe(1);
    expect(createPresenterState(3, 7).slide).toBe(2);
    expect(createPresenterState(3, -2).slide).toBe(0);
  });

  it("7.1a refuses a count that is not an integer >= 1 with a RangeError", () => {
    expect(() => createPresenterState(0)).toThrow(RangeError);
    expect(() => createPresenterState(-1)).toThrow(RangeError);
    expect(() => createPresenterState(2.5)).toThrow(RangeError);
    expect(() => createPresenterState(Number.NaN)).toThrow(RangeError);
  });
});

describe("reducePresenter slide moves", () => {
  it("7.1a next moves by one and stops at the last slide", () => {
    const s = createPresenterState(3);
    expect(reducePresenter(s, { kind: "next" }, 0).slide).toBe(1);
    expect(run(s, [{ kind: "next" }, { kind: "next" }, { kind: "next" }, { kind: "next" }]).slide).toBe(2);
  });

  it("7.1a previous moves back by one and stops at slide 0", () => {
    const s = createPresenterState(3, 2);
    expect(reducePresenter(s, { kind: "previous" }, 0).slide).toBe(1);
    expect(run(s, [{ kind: "previous" }, { kind: "previous" }, { kind: "previous" }]).slide).toBe(0);
  });

  it("7.1a first and last go to slide 0 and count-1", () => {
    expect(reducePresenter(createPresenterState(4, 2), { kind: "first" }, 0).slide).toBe(0);
    expect(reducePresenter(createPresenterState(4, 1), { kind: "last" }, 0).slide).toBe(3);
  });

  it("7.1a goto clamps to 0..count-1", () => {
    const s = createPresenterState(4);
    expect(reducePresenter(s, { kind: "goto", slide: 2 }, 0).slide).toBe(2);
    expect(reducePresenter(s, { kind: "goto", slide: 9 }, 0).slide).toBe(3);
    expect(reducePresenter(createPresenterState(4, 2), { kind: "goto", slide: -3 }, 0).slide).toBe(0);
  });

  it("7.1a a non-integer goto is ignored and returns the same object", () => {
    const s = createPresenterState(4, 1);
    expect(reducePresenter(s, { kind: "goto", slide: 1.5 }, 0)).toBe(s);
    expect(reducePresenter(s, { kind: "goto", slide: Number.NaN }, 0)).toBe(s);
  });

  it("7.1a returns the same object when nothing changes", () => {
    const atStart = createPresenterState(3);
    expect(reducePresenter(atStart, { kind: "previous" }, 0)).toBe(atStart);
    expect(reducePresenter(atStart, { kind: "first" }, 0)).toBe(atStart);
  });

  it("7.1a returns a new object on a change and leaves the input untouched", () => {
    const s = createPresenterState(3);
    const copy = { ...s };
    const next = reducePresenter(s, { kind: "next" }, 1000);
    expect(next).not.toBe(s);
    expect(s).toEqual(copy);
  });
});

describe("reducePresenter black screen", () => {
  it("7.1a toggleBlack flips black", () => {
    const s = createPresenterState(3);
    const black = reducePresenter(s, { kind: "toggleBlack" }, 0);
    expect(black.black).toBe(true);
    expect(reducePresenter(black, { kind: "toggleBlack" }, 0).black).toBe(false);
  });

  it("7.1a any slide move clears black", () => {
    const black = reducePresenter(createPresenterState(4, 1), { kind: "toggleBlack" }, 0);
    for (const action of [{ kind: "next" }, { kind: "previous" }, { kind: "first" }, { kind: "last" }, { kind: "goto", slide: 3 }] as PresenterAction[]) {
      expect(reducePresenter(black, action, 0).black).toBe(false);
    }
  });
});

describe("reducePresenter timer", () => {
  it("7.1a the timer starts on the first next, at now", () => {
    const s = createPresenterState(4);
    const started = reducePresenter(s, { kind: "next" }, 1000);
    expect(started.startedAt).toBe(1000);
    expect(reducePresenter(started, { kind: "next" }, 5000).startedAt).toBe(1000);
  });

  it("7.1a a goto or last that changes the slide starts the timer", () => {
    expect(reducePresenter(createPresenterState(4), { kind: "goto", slide: 2 }, 300).startedAt).toBe(300);
    expect(reducePresenter(createPresenterState(4), { kind: "last" }, 400).startedAt).toBe(400);
  });

  it("7.1a toggleBlack does not start the timer", () => {
    expect(reducePresenter(createPresenterState(4), { kind: "toggleBlack" }, 300).startedAt).toBeNull();
  });

  it("7.1a elapsed time is 0 before the start and counts from startedAt", () => {
    const s = createPresenterState(4);
    expect(presenterElapsedMs(s, 99_000)).toBe(0);
    const started = reducePresenter(s, { kind: "next" }, 1000);
    expect(presenterElapsedMs(started, 6000)).toBe(5000);
  });

  it("7.1a pauseTimer sets pausedAt and freezes the elapsed time", () => {
    const started = reducePresenter(createPresenterState(4), { kind: "next" }, 1000);
    const paused = reducePresenter(started, { kind: "pauseTimer" }, 4000);
    expect(paused.pausedAt).toBe(4000);
    expect(presenterElapsedMs(paused, 10_000)).toBe(3000);
  });

  it("7.1a pauseTimer before the start or while paused changes nothing", () => {
    const s = createPresenterState(4);
    expect(reducePresenter(s, { kind: "pauseTimer" }, 500)).toBe(s);
    const paused = run(reducePresenter(s, { kind: "next" }, 1000), [{ kind: "pauseTimer" }], 4000);
    expect(reducePresenter(paused, { kind: "pauseTimer" }, 8000)).toBe(paused);
  });

  it("7.1a resumeTimer adds the paused span to pausedTotal and clears pausedAt", () => {
    const started = reducePresenter(createPresenterState(4), { kind: "next" }, 1000);
    const paused = reducePresenter(started, { kind: "pauseTimer" }, 4000);
    const resumed = reducePresenter(paused, { kind: "resumeTimer" }, 9000);
    expect(resumed.pausedAt).toBeNull();
    expect(resumed.pausedTotal).toBe(5000);
    expect(presenterElapsedMs(resumed, 12_000)).toBe(6000);
  });

  it("7.1a resetTimer stops the timer and clears the paused time", () => {
    const paused = run(reducePresenter(createPresenterState(4), { kind: "next" }, 1000), [{ kind: "pauseTimer" }], 4000);
    const reset = reducePresenter(paused, { kind: "resetTimer" }, 7000);
    expect(reset).toMatchObject({ startedAt: null, pausedAt: null, pausedTotal: 0, slide: 1 });
    expect(presenterElapsedMs(reset, 20_000)).toBe(0);
  });

  it("7.1a after a reset the next advance starts the timer again", () => {
    const reset = run(reducePresenter(createPresenterState(4), { kind: "next" }, 1000), [{ kind: "resetTimer" }], 2000);
    expect(reducePresenter(reset, { kind: "next" }, 8000).startedAt).toBe(8000);
  });

  it("7.1a elapsed time is never below 0", () => {
    const started = reducePresenter(createPresenterState(4), { kind: "next" }, 5000);
    expect(presenterElapsedMs(started, 1000)).toBe(0);
  });
});

// --- 7.1b ---------------------------------------------------------------------------------------------------------------------------

describe("presenterKeyAction", () => {
  it.each(["ArrowRight", "ArrowDown", " ", "PageDown"])("7.1b %j gives next", (key) => {
    expect(presenterKeyAction(key)).toEqual({ kind: "next" });
  });

  it.each(["ArrowLeft", "ArrowUp", "PageUp"])("7.1b %j gives previous", (key) => {
    expect(presenterKeyAction(key)).toEqual({ kind: "previous" });
  });

  it("7.1b Home gives first and End gives last", () => {
    expect(presenterKeyAction("Home")).toEqual({ kind: "first" });
    expect(presenterKeyAction("End")).toEqual({ kind: "last" });
  });

  it("7.1b b and B toggle the black screen", () => {
    expect(presenterKeyAction("b")).toEqual({ kind: "toggleBlack" });
    expect(presenterKeyAction("B")).toEqual({ kind: "toggleBlack" });
  });

  it("7.1b Escape gives exit", () => {
    expect(presenterKeyAction("Escape")).toBe("exit");
  });

  it.each(["a", "Enter", "Tab", "x", "Shift", ""])("7.1b %j gives null", (key) => {
    expect(presenterKeyAction(key)).toBeNull();
  });
});

describe("formatPresenterTime", () => {
  it("7.1b formats m:ss below one hour", () => {
    expect(formatPresenterTime(0)).toBe("0:00");
    expect(formatPresenterTime(5000)).toBe("0:05");
    expect(formatPresenterTime(725_000)).toBe("12:05");
    expect(formatPresenterTime(3_599_000)).toBe("59:59");
  });

  it("7.1b floors to whole seconds", () => {
    expect(formatPresenterTime(999)).toBe("0:00");
    expect(formatPresenterTime(65_999)).toBe("1:05");
    expect(formatPresenterTime(3_599_999)).toBe("59:59");
  });

  it("7.1b formats h:mm:ss from one hour", () => {
    expect(formatPresenterTime(3_600_000)).toBe("1:00:00");
    expect(formatPresenterTime(3_725_000)).toBe("1:02:05");
    expect(formatPresenterTime(36_000_000 + 61_000)).toBe("10:01:01");
  });
});
