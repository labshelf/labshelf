/** @jest-environment jsdom */
/**
 * Spec 7.1: openPresenter, the audience view and the presenter view over deck frames, synced through a PresenterChannel port.
 * The channel is a fake bus: a message posted on one channel reaches the listeners of every other channel of the bus on a later
 * microtask (as a BroadcastChannel does, never the poster itself). The clock is jest fake timers plus a `now` option the test sets.
 * jsdom does not load srcdoc frames, so the harness parses each srcdoc into the frame's document and fires load, as a browser would.
 * View-specific keys are dispatched on that view's frame contentDocument, so that the other view, which shares the jsdom document,
 * does not see them.
 */
import { openPresenter, type PresenterController, type PresenterOptions } from "../../../src/decks/dom/openPresenter";
import type { PresenterChannel, PresenterMessage } from "../../../src/decks/present/presenterChannel";
import { watchStyleMarkup } from "./styleMarkupWatch";

const THEME = ":root { --deck-bg: #ffffff; --deck-fg: #1a1a1a; }\n";
const DECK = [
  "<!doctype html>",
  '<html lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px">',
  '<head>\n<meta charset="utf-8">\n<title>Talk</title>\n<link rel="stylesheet" href="theme.css" data-deck-theme>\n</head>',
  "<body>",
  '<section data-slide>\n<div data-block="title" style="left: 120px; top: 80px; width: 1680px; height: 200px;"><h1>Opening</h1></div>\n<aside data-notes>Say hello.</aside>\n</section>',
  '<section data-slide>\n<div data-block="body" style="left: 120px; top: 320px; width: 1680px; height: 600px;"><p>Middle.</p></div>\n</section>',
  '<section data-slide>\n<div data-block="end" style="left: 120px; top: 320px; width: 1680px; height: 600px;"><p>Thanks.</p></div>\n<aside data-notes>Thank them.</aside>\n</section>',
  "</body>",
  "</html>",
  "",
].join("\n");

// --- srcdoc shim ---------------------------------------------------------------------------------------------------------------------

const written = new WeakMap<HTMLIFrameElement, string>();
let observer: MutationObserver | undefined;

function loadSrcdocFrames(): void {
  for (const frame of Array.from(document.querySelectorAll("iframe"))) {
    const srcdoc = frame.getAttribute("srcdoc");
    const doc = frame.contentDocument;
    if (srcdoc == null || !doc || written.get(frame) === srcdoc) continue;
    written.set(frame, srcdoc);
    doc.open();
    doc.write(srcdoc);
    doc.close();
    frame.dispatchEvent(new Event("load"));
  }
}

beforeAll(() => {
  observer = new MutationObserver(loadSrcdocFrames);
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["srcdoc"] });
});
afterAll(() => observer?.disconnect());

// --- fake bus, clock, views ----------------------------------------------------------------------------------------------------------

interface FakeChannel extends PresenterChannel { posted: PresenterMessage[]; close: jest.Mock<void, []> }

function createBus(): () => FakeChannel {
  const members: Set<(message: PresenterMessage) => void>[] = [];
  return () => {
    const listeners = new Set<(message: PresenterMessage) => void>();
    members.push(listeners);
    const channel: FakeChannel = {
      posted: [],
      post(message) {
        channel.posted.push(message);
        const copy = JSON.stringify(message);
        void Promise.resolve().then(() => {
          for (const other of members) if (other !== listeners) for (const listener of [...other]) listener(JSON.parse(copy) as PresenterMessage);
        });
      },
      onMessage(listener) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      close: jest.fn<void, []>(),
    };
    return channel;
  };
}

let clock = 0;
let opened: PresenterController[] = [];

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick", "setImmediate"] });
  clock = 0;
});

afterEach(() => {
  for (const view of opened) {
    try {
      view.destroy();
    } catch {
      // already destroyed
    }
  }
  opened = [];
  document.body.innerHTML = "";
  jest.useRealTimers();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    loadSrcdocFrames();
    await jest.advanceTimersByTimeAsync(0);
  }
}

function view(role: "audience" | "presenter", channel: PresenterChannel, extra: Partial<PresenterOptions> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const onExit = jest.fn();
  const controller = openPresenter(host, {
    role,
    html: DECK,
    theme: THEME,
    channel,
    resolveAsset: async (p: string) => `blob:asset/${p}`,
    now: () => clock,
    onExit,
    ...extra,
  });
  opened.push(controller);
  return { host, controller, onExit };
}

const accessibleName = (el: Element): string => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
function button(host: HTMLElement, name: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => accessibleName(b) === name);
  if (!found) throw new Error(`no button named "${name}"`);
  return found;
}
const frames = (host: HTMLElement) => Array.from(host.querySelectorAll("iframe"));
const frameTitles = (host: HTMLElement) => frames(host).map((f) => f.getAttribute("title"));
function key(target: Document, k: string): void {
  const KeyboardEventCtor = target.defaultView?.KeyboardEvent ?? KeyboardEvent;
  target.dispatchEvent(new KeyboardEventCtor("keydown", { key: k, bubbles: true, cancelable: true }));
}
function frameDoc(host: HTMLElement, index = 0): Document {
  const doc = frames(host)[index]?.contentDocument;
  if (!doc) throw new Error("no frame document");
  return doc;
}
const notes = (host: HTMLElement) => host.querySelector("[data-presenter-notes]")?.textContent ?? "";
const timer = (host: HTMLElement) => (host.querySelector("[data-presenter-timer]")?.textContent ?? "").trim();
/** Elements whose own text is exactly the given text and that are not inside a hidden element. */
const visibleText = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll<HTMLElement>("*")).filter((el) => el.textContent?.trim() === text && el.children.length === 0 && !el.closest("[hidden]"));
/** Elements of the audience root that may be the black cover: hidden elements that are not the frame and do not hold it. */
const hiddenCandidates = (root: Element) => Array.from(root.querySelectorAll<HTMLElement>("[hidden]")).filter((el) => el.tagName !== "IFRAME" && !el.querySelector("iframe"));

// --- 7.1d ---------------------------------------------------------------------------------------------------------------------------

describe("presenter view", () => {
  it("7.1d shows the notes of the current slide, and 'No notes' on a slide without notes", async () => {
    const { host, controller } = view("presenter", createBus()());
    await settle();
    expect(notes(host)).toContain("Say hello.");
    controller.dispatch({ kind: "next" });
    await settle();
    expect(notes(host)).toContain("No notes");
    expect(notes(host)).not.toContain("Say hello.");
  });

  it("7.1d shows the slide label Slide <n> of <count>", async () => {
    const { host, controller } = view("presenter", createBus()());
    await settle();
    expect(host.textContent).toContain("Slide 1 of 3");
    controller.dispatch({ kind: "next" });
    await settle();
    expect(host.textContent).toContain("Slide 2 of 3");
  });

  it("7.1d shows the current and the next slide in deck frames", async () => {
    const { host, controller } = view("presenter", createBus()());
    await settle();
    expect(frameTitles(host)).toEqual(expect.arrayContaining(["Slide 1", "Slide 2"]));
    controller.dispatch({ kind: "next" });
    await settle();
    expect(frameTitles(host)).toEqual(expect.arrayContaining(["Slide 2", "Slide 3"]));
  });

  it("7.1d shows 'End of presentation' in place of the next slide only on the last slide", async () => {
    const { host, controller } = view("presenter", createBus()());
    await settle();
    expect(visibleText(host, "End of presentation")).toHaveLength(0);
    controller.dispatch({ kind: "last" });
    await settle();
    expect(frameTitles(host)).toContain("Slide 3");
    expect(visibleText(host, "End of presentation").length).toBeGreaterThan(0);
  });

  it("7.1d shows the timer, which starts at 0:00 and is updated each second", async () => {
    const { host, controller } = view("presenter", createBus()());
    await settle();
    expect(timer(host)).toBe("0:00");
    clock = 1000;
    controller.dispatch({ kind: "next" });
    clock = 66_000;
    await jest.advanceTimersByTimeAsync(1000);
    expect(timer(host)).toBe("1:05");
    clock = 67_000;
    await jest.advanceTimersByTimeAsync(1000);
    expect(timer(host)).toBe("1:06");
  });

  it("7.1d has Previous, Next, Black screen, Pause and Reset buttons that act on the state", async () => {
    const { host, controller } = view("presenter", createBus()());
    await settle();
    clock = 1000;
    button(host, "Next").click();
    expect(controller.state().slide).toBe(1);
    button(host, "Previous").click();
    expect(controller.state().slide).toBe(0);
    button(host, "Black screen").click();
    expect(controller.state().black).toBe(true);
    clock = 3000;
    button(host, "Pause").click();
    expect(controller.state().pausedAt).toBe(3000);
    clock = 5000;
    button(host, "Resume").click();
    expect(controller.state()).toMatchObject({ pausedAt: null, pausedTotal: 2000 });
    button(host, "Reset").click();
    expect(controller.state()).toMatchObject({ startedAt: null, pausedAt: null, pausedTotal: 0 });
  });

  it("7.1d keys on the host document drive the presenter state", async () => {
    const { controller } = view("presenter", createBus()());
    await settle();
    key(document, "ArrowRight");
    expect(controller.state().slide).toBe(1);
    key(document, "End");
    expect(controller.state().slide).toBe(2);
    key(document, "b");
    expect(controller.state().black).toBe(true);
  });

  it("7.1d keys on a frame's document drive the presenter state", async () => {
    const { host, controller } = view("presenter", createBus()());
    await settle();
    key(frameDoc(host), "PageDown");
    expect(controller.state().slide).toBe(1);
  });

  it("7.1d the presenter view uses no style= attribute", async () => {
    const markup = watchStyleMarkup();
    try {
      const { controller } = view("presenter", createBus()());
      await settle();
      controller.dispatch({ kind: "next" });
      await settle();
      expect(markup.writes).toEqual([]);
    } finally {
      markup.restore();
    }
  });
});

describe("audience view", () => {
  it("7.1d mounts a .ls-deck-present root with one deck frame showing the current slide", async () => {
    const { host } = view("audience", createBus()());
    await settle();
    const root = host.querySelector(".ls-deck-present");
    expect(root).not.toBeNull();
    expect(frameTitles(root as HTMLElement)).toEqual(["Slide 1"]);
  });

  it("7.1d the black cover is hidden until the state is black", async () => {
    const bus = createBus();
    const presenter = view("presenter", bus());
    const audience = view("audience", bus());
    await settle();
    const root = audience.host.querySelector(".ls-deck-present")!;
    const before = hiddenCandidates(root);
    presenter.controller.dispatch({ kind: "toggleBlack" });
    await settle();
    const shown = before.filter((el) => !el.hasAttribute("hidden"));
    expect(shown).toHaveLength(1);
    presenter.controller.dispatch({ kind: "toggleBlack" });
    await settle();
    expect(shown[0]!.hasAttribute("hidden")).toBe(true);
  });

  it("7.1d scales the frame to fit the host through a CSSOM transform", async () => {
    const host = document.createElement("div");
    Object.defineProperty(host, "clientWidth", { configurable: true, value: 960 });
    Object.defineProperty(host, "clientHeight", { configurable: true, value: 540 });
    host.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540, toJSON: () => ({}) }) as DOMRect;
    document.body.append(host);
    opened.push(openPresenter(host, { role: "audience", html: DECK, theme: THEME, channel: createBus()(), resolveAsset: async (p) => p, now: () => clock }));
    await settle();
    const transforms = Array.from(host.querySelectorAll<HTMLElement>("*")).map((el) => el.style.transform);
    expect(transforms.some((t) => /scale\(\s*0\.5\b|matrix\(\s*0\.5\b/.test(t))).toBe(true);
  });

  it("7.1d calls requestFullscreen with the root on open and ignores a rejection", async () => {
    const requestFullscreen = jest.fn((_el: HTMLElement) => Promise.reject(new Error("denied")));
    const { host } = view("audience", createBus()(), { requestFullscreen });
    await settle();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen.mock.calls[0]![0]).toBe(host.querySelector(".ls-deck-present"));
  });

  it("7.1d posts hello once on open", async () => {
    const channel = createBus()();
    view("audience", channel);
    await settle();
    expect(channel.posted.filter((m) => m.type === "hello")).toHaveLength(1);
  });

  it("7.1d audience keys post actions and do not change its own state", async () => {
    const channel = createBus()();
    const { controller } = view("audience", channel);
    await settle();
    key(document, "ArrowRight");
    key(document, "b");
    await settle();
    expect(channel.posted).toEqual(expect.arrayContaining([{ type: "action", action: { kind: "next" } }, { type: "action", action: { kind: "toggleBlack" } }]));
    expect(controller.state()).toMatchObject({ slide: 0, black: false });
  });

  it("7.1d the audience view uses no style= attribute", async () => {
    const markup = watchStyleMarkup();
    try {
      view("audience", createBus()());
      await settle();
      expect(markup.writes).toEqual([]);
    } finally {
      markup.restore();
    }
  });
});

// --- 7.1e ---------------------------------------------------------------------------------------------------------------------------

describe("presenter and audience over one channel", () => {
  async function pair() {
    const bus = createBus();
    const presenterChannel = bus();
    const audienceChannel = bus();
    const presenter = view("presenter", presenterChannel);
    const audience = view("audience", audienceChannel);
    await settle();
    return { presenter, audience, presenterChannel, audienceChannel };
  }

  it("7.1e the audience follows every presenter change", async () => {
    const { presenter, audience } = await pair();
    const actions = [{ kind: "next" }, { kind: "next" }, { kind: "toggleBlack" }, { kind: "previous" }, { kind: "pauseTimer" }, { kind: "last" }, { kind: "first" }] as const;
    for (const action of actions) {
      clock += 1000;
      presenter.controller.dispatch(action);
      await settle();
      expect(audience.controller.state()).toEqual(presenter.controller.state());
    }
  });

  it("7.1e the audience frame shows the presenter's current slide", async () => {
    const { presenter, audience } = await pair();
    presenter.controller.dispatch({ kind: "next" });
    await settle();
    expect(frameTitles(audience.host)).toEqual(["Slide 2"]);
  });

  it("7.1e the presenter posts its state after a change", async () => {
    const { presenter, presenterChannel } = await pair();
    presenterChannel.posted.length = 0;
    presenter.controller.dispatch({ kind: "next" });
    await settle();
    const states = presenterChannel.posted.filter((m): m is Extract<PresenterMessage, { type: "state" }> => m.type === "state");
    expect(states[states.length - 1]?.state).toEqual(presenter.controller.state());
  });

  it("7.1e an audience opened later gets the current state through hello", async () => {
    const bus = createBus();
    const presenter = view("presenter", bus());
    await settle();
    presenter.controller.dispatch({ kind: "next" });
    presenter.controller.dispatch({ kind: "next" });
    await settle();
    const audience = view("audience", bus());
    await settle();
    expect(audience.controller.state().slide).toBe(2);
  });

  it("7.1e audience keys reach the presenter as actions", async () => {
    const { presenter, audience } = await pair();
    key(frameDoc(audience.host), "ArrowRight");
    await settle();
    expect(presenter.controller.state().slide).toBe(1);
    expect(audience.controller.state().slide).toBe(1);
    key(frameDoc(audience.host), "B");
    await settle();
    expect(presenter.controller.state().black).toBe(true);
  });

  it("7.1e Escape on the presenter side calls onExit on both sides and posts exit", async () => {
    const { presenter, audience, presenterChannel } = await pair();
    key(frameDoc(presenter.host), "Escape");
    await settle();
    expect(presenter.onExit).toHaveBeenCalled();
    expect(presenterChannel.posted).toContainEqual({ type: "exit" });
    expect(audience.onExit).toHaveBeenCalled();
  });

  it("7.1e Escape on the audience side calls onExit on both sides and posts exit", async () => {
    const { presenter, audience, audienceChannel } = await pair();
    key(frameDoc(audience.host), "Escape");
    await settle();
    expect(audience.onExit).toHaveBeenCalled();
    expect(audienceChannel.posted).toContainEqual({ type: "exit" });
    expect(presenter.onExit).toHaveBeenCalled();
  });

  it("7.1e destroy clears the timer interval, removes the DOM and does not close the channel", async () => {
    const setSpy = jest.spyOn(window, "setInterval");
    const clearSpy = jest.spyOn(window, "clearInterval");
    const { presenter, presenterChannel } = await pair();
    const ids = setSpy.mock.calls.flatMap(([, delay], i) => (delay === 1000 ? [setSpy.mock.results[i]!.value as unknown] : []));
    expect(ids.length).toBeGreaterThan(0);
    presenter.controller.destroy();
    for (const id of ids) expect(clearSpy.mock.calls.map(([cleared]) => cleared as unknown)).toContain(id);
    expect(presenter.host.childElementCount).toBe(0);
    expect(presenterChannel.close).not.toHaveBeenCalled();
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });

  it("7.1e after destroy the presenter no longer reacts to keys", async () => {
    const { presenter } = await pair();
    presenter.controller.destroy();
    key(document, "ArrowRight");
    await settle();
    expect(presenter.controller.state().slide).toBe(0);
  });
});

// --- A5 -----------------------------------------------------------------------------------------------------------------------------

describe("presenter mode", () => {
  it("A5 shows notes, timer, current and next slide, and the full-screen audience view follows the presenter", async () => {
    const bus = createBus();
    const requestFullscreen = jest.fn(async (_el: HTMLElement) => undefined);
    const presenter = view("presenter", bus());
    const audience = view("audience", bus(), { requestFullscreen });
    await settle();
    expect(requestFullscreen).toHaveBeenCalledWith(audience.host.querySelector(".ls-deck-present"));
    clock = 2000;
    presenter.controller.dispatch({ kind: "next" });
    presenter.controller.dispatch({ kind: "next" });
    clock = 32_000;
    await jest.advanceTimersByTimeAsync(1000);
    await settle();
    expect(notes(presenter.host)).toContain("Thank them.");
    expect(timer(presenter.host)).toBe("0:30");
    expect(frameTitles(presenter.host)).toContain("Slide 3");
    expect(presenter.host.textContent).toContain("Slide 3 of 3");
    expect(frameTitles(audience.host)).toEqual(["Slide 3"]);
    expect(audience.controller.state().slide).toBe(2);
  });
});
