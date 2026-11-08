/** @jest-environment jsdom */
/**
 * Spec 11.1 (A11): the PDF slide source over a page-to-slide map with divider pages, and the presenter view's next box and clock.
 * Sources are fakes driven through openSlidesPresenter; the clock is jest fake timers plus a `now` option the test sets.
 */
import { openSlidesPresenter, type PresenterController, type PresenterSlideSource } from "../../../src/decks/dom/openPresenter";
import { pdfSlideSource, type PdfDeck } from "../../../src/decks/dom/pdfDeck";
import type { PresenterChannel } from "../../../src/decks/presenterChannel";

const CANVAS = { width: 1920, height: 1080 };
// Seven pages: a divider, slide 0 and its overlay, slide 1, a divider, slides 2 and 3 (the labels 1 2 2 3 4 5 6).
const MAP = [-1, 0, 0, 1, -1, 2, 3];
const NOTES = ["notes zero", "notes one", "notes two", "notes three"];

let clock = 0;
let opened: PresenterController[] = [];

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick", "setImmediate"] });
  clock = new Date(2026, 5, 1, 9, 5, 0).getTime();
});

afterEach(() => {
  for (const controller of opened) controller.destroy();
  opened = [];
  document.body.innerHTML = "";
  jest.useRealTimers();
});

const channel = (): PresenterChannel => ({ post: () => undefined, onMessage: () => () => undefined, close: () => undefined });

function open(source: PresenterSlideSource, slide = 0) {
  const host = document.createElement("div");
  document.body.append(host);
  const controller = openSlidesPresenter(host, { role: "presenter", source, channel: channel(), now: () => clock, slide });
  opened.push(controller);
  return { host, controller };
}

/** A source of `count` steps that records, per box, the slide it shows now. */
function fakeSource(count: number, nextOf?: (slide: number) => number) {
  const shown: Array<{ box: HTMLElement; slide: number }> = [];
  const source: PresenterSlideSource = {
    count,
    canvas: CANVAS,
    notes: (slide) => `notes ${slide}`,
    ...(nextOf ? { nextOf } : {}),
    mount: (box, slide) => {
      const entry = { box, slide };
      shown.push(entry);
      const element = document.createElement("div");
      box.append(element);
      return { element, setSlide: (next) => { entry.slide = next; }, destroy: () => element.remove() };
    },
  };
  const inNext = (): number | undefined => shown.find((s) => s.box.closest(".ls-deck-presenter-next"))?.slide;
  const inCurrent = (): number | undefined => shown.find((s) => s.box.closest(".ls-deck-presenter-current"))?.slide;
  return { source, inNext, inCurrent };
}

const visibleText = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll<HTMLElement>("*")).filter((el) => el.textContent?.trim() === text && el.children.length === 0 && !el.closest("[hidden]"));
const clockEl = (host: HTMLElement) => host.querySelector<HTMLElement>(".ls-deck-presenter-head .ls-deck-presenter-clock");
const tick = (): Promise<void> => jest.advanceTimersByTimeAsync(1000);

// --- the PDF slide source ----------------------------------------------------------------------------------------------------------

function fakePdf(count: number) {
  const render = jest.fn<Promise<void>, [HTMLCanvasElement, number, number]>(() => Promise.resolve());
  const pdf: PdfDeck = {
    count,
    labels: null,
    pageSize: () => ({ width: 960, height: 540 }),
    render,
    textRuns: () => Promise.resolve([]),
    destroy: () => undefined,
  };
  return { pdf, render };
}

describe("pdfSlideSource over a map with divider pages", () => {
  const source = () => pdfSlideSource(fakePdf(7).pdf, NOTES, MAP);

  it("A11 gives a divider page no notes and the label 'Page 1 of 7'", () => {
    const s = source();
    expect(s.notes(0)).toBe("");
    expect(s.label?.(0, 7)).toBe("Page 1 of 7");
    expect(s.notes(4)).toBe("");
    expect(s.label?.(4, 7)).toBe("Page 5 of 7");
  });

  it("A11 shows the notes of the slide a page belongs to", () => {
    const s = source();
    expect(s.notes(1)).toBe("notes zero");
    expect(s.notes(2)).toBe("notes zero");
    expect(s.notes(3)).toBe("notes one");
    expect(s.notes(6)).toBe("notes three");
    expect(s.label?.(1, 7)).toContain("page 2 of 7");
  });

  it("A11 nextOf skips the overlay pages of the same slide", () => {
    const s = source();
    expect(s.nextOf?.(1)).toBe(3);
    expect(s.nextOf?.(2)).toBe(3);
  });

  it("A11 nextOf counts a divider as a different slide", () => {
    const s = source();
    expect(s.nextOf?.(0)).toBe(1);
    expect(s.nextOf?.(3)).toBe(4);
    expect(s.nextOf?.(4)).toBe(5);
  });

  it("A11 nextOf is page + 1 with a null map", () => {
    const s = pdfSlideSource(fakePdf(5).pdf, NOTES, null);
    expect(s.nextOf?.(0)).toBe(1);
    expect(s.nextOf?.(3)).toBe(4);
  });

  it("A11 still counts one step per page", () => {
    expect(source().count).toBe(7);
  });

  it("A11 shows the next slide's first page in the presenter's next box, not the next overlay page", () => {
    const { pdf, render } = fakePdf(7);
    const { host } = open(pdfSlideSource(pdf, NOTES, MAP), 1);
    const nextCanvas = host.querySelector(".ls-deck-presenter-next canvas") as HTMLCanvasElement;
    const lastPage = render.mock.calls.filter(([canvas]) => canvas === nextCanvas).map(([, page]) => page).pop();
    expect(lastPage).toBe(3);
  });
});

// --- the next box ------------------------------------------------------------------------------------------------------------------

describe("presenter view next box", () => {
  it("A11 mounts source.nextOf(slide) when the source defines it", () => {
    const { source, inNext } = fakeSource(7, (slide) => (slide <= 2 ? 3 : slide + 1));
    open(source, 1);
    expect(inNext()).toBe(3);
  });

  it("A11 follows nextOf when the slide changes", async () => {
    const { source, inNext, inCurrent } = fakeSource(7, (slide) => (slide <= 2 ? 3 : slide + 1));
    const { controller } = open(source, 0);
    expect(inNext()).toBe(3);
    controller.dispatch({ kind: "next" });
    await tick();
    expect(inCurrent()).toBe(1);
    expect(inNext()).toBe(3);
    controller.dispatch({ kind: "goto", slide: 4 });
    await tick();
    expect(inNext()).toBe(5);
  });

  it("A11 shows slide + 1 when the source has no nextOf", async () => {
    const { source, inNext } = fakeSource(4);
    const { controller } = open(source, 0);
    expect(inNext()).toBe(1);
    controller.dispatch({ kind: "next" });
    await tick();
    expect(inNext()).toBe(2);
  });

  it("A11 shows 'End of presentation' when nextOf is past the last step before the last page", () => {
    const { source } = fakeSource(5, (slide) => (slide >= 2 ? 5 : slide + 1));
    const { host } = open(source, 2);
    expect(visibleText(host, "End of presentation").length).toBeGreaterThan(0);
  });

  it("A11 hides 'End of presentation' while nextOf points at a step", () => {
    const { source } = fakeSource(5, (slide) => (slide >= 2 ? 5 : slide + 1));
    const { host } = open(source, 1);
    expect(visibleText(host, "End of presentation")).toHaveLength(0);
  });

  it("A11 shows 'End of presentation' on the last step without nextOf", () => {
    const { source } = fakeSource(3);
    const { host } = open(source, 2);
    expect(visibleText(host, "End of presentation").length).toBeGreaterThan(0);
  });

  it("A11 shows 'End of presentation' on the last page of a PDF talk", () => {
    const { host } = open(pdfSlideSource(fakePdf(7).pdf, NOTES, MAP), 6);
    expect(visibleText(host, "End of presentation").length).toBeGreaterThan(0);
  });

  it("A11 keeps Next stepping one page whatever nextOf says", () => {
    const { source } = fakeSource(7, (slide) => (slide <= 2 ? 3 : slide + 1));
    const { host, controller } = open(source, 1);
    const next = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === "Next");
    next?.click();
    expect(controller.state().slide).toBe(2);
  });
});

// --- the clock ---------------------------------------------------------------------------------------------------------------------

describe("presenter view clock", () => {
  it("A11 has a span.ls-deck-presenter-clock named Clock in the head", () => {
    const { host } = open(fakeSource(3).source);
    const el = clockEl(host);
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe("SPAN");
    expect(el?.getAttribute("aria-label")).toBe("Clock");
  });

  it("A11 shows HH:MM of the injected clock, zero padded", async () => {
    const { host } = open(fakeSource(3).source);
    await tick();
    expect(clockEl(host)?.textContent?.trim()).toBe("09:05");
  });

  it("A11 updates the clock on the 1 s interval", async () => {
    const { host } = open(fakeSource(3).source);
    await tick();
    clock = new Date(2026, 5, 1, 13, 47, 10).getTime();
    await tick();
    expect(clockEl(host)?.textContent?.trim()).toBe("13:47");
  });

  it("A11 shows 00:00 just after midnight in 24 hour time", async () => {
    clock = new Date(2026, 5, 1, 0, 0, 30).getTime();
    const { host } = open(fakeSource(3).source);
    await tick();
    expect(clockEl(host)?.textContent?.trim()).toBe("00:00");
  });

  it("A11 gives the clock no style attribute", () => {
    const { host } = open(fakeSource(3).source);
    expect(clockEl(host)?.hasAttribute("style")).toBe(false);
  });

  it("A11 keeps the elapsed timer beside the clock", async () => {
    const { host } = open(fakeSource(3).source);
    await tick();
    expect(host.querySelector("[data-presenter-timer]")?.textContent?.trim()).toBe("0:00");
  });
});
