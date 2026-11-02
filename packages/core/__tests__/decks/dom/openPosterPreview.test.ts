/** @jest-environment jsdom */
/**
 * Spec 7.2: openPosterPreview, the poster preview with zoom, pan, rulers in mm or in, a calibration kept through a CalibrationStore
 * port, and the small-text list. The store is a jest fake; the clock is jest fake timers with a fixed system time.
 * jsdom has no layout: the host reports 1000 x 800 px; the poster is A0 (841 x 1189 mm), whose threshold is 24 pt. Each leaf gets
 * its font size from a theme class, read in the frame through getComputedStyle (20 px = 15 pt, 16 px = 12 pt, 32 px = 24 pt).
 * jsdom does not load srcdoc frames, so the harness parses each srcdoc into the frame's document and fires load, as a browser would.
 * Pointer and wheel events are dispatched on the deck frame element and bubble to its ancestors.
 */
import { openPosterPreview, type PosterPreviewController, type PosterPreviewOptions } from "../../../src/decks/dom/openPosterPreview";
import type { CalibrationStore, PosterCalibration } from "../../../src/decks/posterMeasure";
import { watchStyleMarkup } from "./styleMarkupWatch";

const THEME = ":root { --deck-bg: #ffffff; }\n.huge { font-size: 96px; }\n.big { font-size: 48px; }\n.edge { font-size: 32px; }\n.small { font-size: 20px; }\n.tiny { font-size: 16px; }\n";
const CAPTION = "Tiny caption text that is long enough to be cut at forty characters";
const HEAD = '<head>\n<meta charset="utf-8">\n<title>Poster</title>\n<link rel="stylesheet" href="theme.css" data-deck-theme>\n</head>';
const deck = (kind: "poster" | "talk", size: string, blocks: string) =>
  ["<!doctype html>", `<html lang="en" data-deck="${kind}" data-deck-version="1" data-deck-size="${size}">`, HEAD, "<body>", `<section data-slide>\n${blocks}\n</section>`, "</body>", "</html>", ""].join("\n");
const POSTER = deck(
  "poster",
  "841x1189mm",
  [
    '<div data-block="title" style="left: 100px; top: 100px; width: 2978px; height: 400px;"><h1 class="huge">Poster title</h1><p class="tiny">Affiliation</p></div>',
    `<div data-block="body" style="left: 100px; top: 600px; width: 2978px; height: 3700px;"><p class="big">Readable text</p><p class="small">${CAPTION}</p><p class="edge">Edge case text</p></div>`,
  ].join("\n"),
);
const LARGE_POSTER = deck("poster", "841x1189mm", '<div data-block="title" style="left: 100px; top: 100px; width: 2978px; height: 400px;"><h1 class="huge">Poster title</h1><p class="edge">Edge case text</p></div>');
const TALK = deck("talk", "1920x1080px", '<div data-block="title" style="left: 120px; top: 80px; width: 1680px; height: 200px;"><h1 class="huge">Title</h1></div>');
const NOW = "2026-03-04T05:06:07.000Z";
const DEFAULT_PX_PER_MM = 96 / 25.4;

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
  const el = Element.prototype as unknown as Record<string, unknown>;
  el.setPointerCapture ??= () => undefined;
  el.releasePointerCapture ??= () => undefined;
  el.hasPointerCapture ??= () => false;
  observer = new MutationObserver(loadSrcdocFrames);
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["srcdoc"] });
});
afterAll(() => observer?.disconnect());

// --- harness -------------------------------------------------------------------------------------------------------------------------

let opened: PosterPreviewController[] = [];

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick", "setImmediate"] });
  jest.setSystemTime(new Date(NOW));
});

afterEach(() => {
  for (const preview of opened) {
    try {
      preview.destroy();
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

function fakeStore(calibration?: PosterCalibration) {
  return {
    load: jest.fn<Promise<PosterCalibration | undefined>, []>(async () => calibration),
    save: jest.fn<Promise<void>, [PosterCalibration]>(async () => undefined),
  } satisfies CalibrationStore;
}

function makeHost(): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { configurable: true, value: 1000 });
  Object.defineProperty(host, "clientHeight", { configurable: true, value: 800 });
  host.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, toJSON: () => ({}) }) as DOMRect;
  document.body.append(host);
  return host;
}

async function open(extra: Partial<PosterPreviewOptions> = {}) {
  const host = makeHost();
  const store = extra.store ?? fakeStore();
  const onSelectLeaf = jest.fn<void, [string, number]>();
  const pending = openPosterPreview(host, { html: POSTER, theme: THEME, store, resolveAsset: async (p: string) => `blob:asset/${p}`, onSelectLeaf, ...extra });
  await settle();
  const preview = await pending;
  opened.push(preview);
  await settle();
  return { host, store: store as ReturnType<typeof fakeStore>, preview, onSelectLeaf };
}

const accessibleName = (el: Element): string => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
const findButton = (host: HTMLElement, name: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => accessibleName(b) === name);
function button(host: HTMLElement, name: string): HTMLButtonElement {
  const found = findButton(host, name);
  if (!found) throw new Error(`no button named "${name}"`);
  return found;
}
const frame = (host: HTMLElement): HTMLIFrameElement => {
  const found = host.querySelector("iframe");
  if (!found) throw new Error("no deck frame");
  return found;
};
const rulerSvgs = (host: HTMLElement) => Array.from(host.querySelectorAll("svg")).filter((svg) => !svg.closest("[data-small-text]"));
const rulerHtml = (host: HTMLElement) => rulerSvgs(host).map((svg) => svg.outerHTML).join("\n");
const rulerLabels = (host: HTMLElement) =>
  rulerSvgs(host)
    .flatMap((svg) => Array.from(svg.querySelectorAll("text")).map((t) => Number((t.textContent ?? "").trim())))
    .filter((n) => Number.isFinite(n));
/** The inline style of every element under the host, then the rules of every style element under the host, as CSS text. */
const layoutSignature = (host: HTMLElement) =>
  [
    ...Array.from(host.querySelectorAll<HTMLElement>("*")).map((el) => el.style?.cssText ?? ""),
    ...Array.from(host.querySelectorAll("style")).flatMap((el) => Array.from(el.sheet?.cssRules ?? []).map((rule) => rule.cssText)),
  ].join("|");

function pointer(target: Element, type: string, x: number, y: number, init: MouseEventInit = {}): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, ...init }));
}
function drag(target: Element, from: [number, number], to: [number, number]): void {
  pointer(target, "pointerdown", ...from);
  pointer(target, "pointermove", (from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  pointer(target, "pointermove", ...to);
  pointer(target, "pointerup", ...to);
}
function wheel(target: Element, deltaY: number, init: WheelEventInit = {}): void {
  target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY, clientX: 500, clientY: 400, ...init }));
}
/** Switches the ruler to unit through the toggle: one button named mm or in, or two such buttons, with aria-pressed. */
function toggleUnit(host: HTMLElement, unit: "mm" | "in"): void {
  const target = findButton(host, unit);
  if (target && target.getAttribute("aria-pressed") !== "true") return target.click();
  button(host, unit === "mm" ? "in" : "mm").click();
}

// --- 7.2c ---------------------------------------------------------------------------------------------------------------------------

describe("poster preview calibration", () => {
  it("7.2c awaits store.load before the first render", async () => {
    let resolveLoad: (value: PosterCalibration | undefined) => void = () => undefined;
    const store = { load: jest.fn(() => new Promise<PosterCalibration | undefined>((r) => (resolveLoad = r))), save: jest.fn(async () => undefined) };
    const host = makeHost();
    const pending = openPosterPreview(host, { html: POSTER, theme: THEME, store, resolveAsset: async (p) => p });
    let done = false;
    void pending.then(() => (done = true));
    await settle();
    expect(store.load).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    expect(host.querySelector("iframe")).toBeNull();
    resolveLoad(undefined);
    await settle();
    opened.push(await pending);
    expect(host.querySelector("iframe")).not.toBeNull();
  });

  it("7.2c shows 'Not calibrated' when the store holds no calibration", async () => {
    const { host, preview, store } = await open();
    expect(store.load).toHaveBeenCalled();
    expect(preview.calibrated()).toBe(false);
    expect(host.textContent).toContain("Not calibrated");
  });

  it("7.2c uses a stored calibration and does not say 'Not calibrated'", async () => {
    const { host, preview } = await open({ store: fakeStore({ pxPerMm: 2 * DEFAULT_PX_PER_MM, measuredAt: NOW }) });
    expect(preview.calibrated()).toBe(true);
    expect(host.textContent).not.toContain("Not calibrated");
  });

  it("7.2c a stored calibration changes the ruler at zoom 1", async () => {
    // Uncalibrated, zoom 1 is 1 screen px per canvas px: majors every 100 mm. At twice the px per mm, majors come every 10 mm.
    const plain = await open();
    plain.preview.setZoom(1);
    await settle();
    expect(rulerLabels(plain.host).length).toBeGreaterThan(0);
    expect(rulerLabels(plain.host).every((n) => n % 100 === 0)).toBe(true);
    const calibrated = await open({ store: fakeStore({ pxPerMm: 2 * DEFAULT_PX_PER_MM, measuredAt: NOW }) });
    calibrated.preview.setZoom(1);
    await settle();
    expect(rulerLabels(calibrated.host).some((n) => n % 100 !== 0)).toBe(true);
  });

  it("7.2c Calibrate shows the card instruction, and a saved drag goes through the store and changes the ruler", async () => {
    const { host, preview, store } = await open();
    preview.setZoom(1);
    await settle();
    const rulerBefore = rulerHtml(host);
    const before = new Set(Array.from(host.querySelectorAll("*")));
    button(host, "Calibrate").click();
    await settle();
    expect(host.textContent).toContain("Drag the line to the width of a bank card (85.6 mm)");
    const handles = Array.from(host.querySelectorAll<HTMLElement>("*")).filter((el) => !before.has(el) && el.tagName !== "BUTTON" && el.children.length === 0 && (el.textContent ?? "").trim() === "");
    for (const handle of handles) drag(handle, [400, 300], [600, 300]);
    button(host, "Save").click();
    await settle();
    expect(store.save).toHaveBeenCalledTimes(1);
    const saved = store.save.mock.calls[0]![0];
    expect(saved.measuredAt).toBe(NOW);
    expect(saved.pxPerMm).toBeGreaterThan(DEFAULT_PX_PER_MM + 0.5);
    expect(preview.calibrated()).toBe(true);
    expect(host.textContent).not.toContain("Not calibrated");
    expect(rulerHtml(host)).not.toBe(rulerBefore);
  });

  it("7.2c Cancel leaves the calibration as it was and saves nothing", async () => {
    const { host, preview, store } = await open();
    button(host, "Calibrate").click();
    await settle();
    button(host, "Cancel").click();
    await settle();
    expect(store.save).not.toHaveBeenCalled();
    expect(preview.calibrated()).toBe(false);
    expect(host.textContent).toContain("Not calibrated");
    expect(host.textContent).not.toContain("Drag the line to the width of a bank card (85.6 mm)");
  });
});

// --- 7.2d ---------------------------------------------------------------------------------------------------------------------------

describe("poster preview zoom, pan and unit", () => {
  it("7.2d the initial zoom fits the whole poster in the host", async () => {
    const { preview } = await open();
    // A0 is 3178.6 x 4493.9 canvas px; uncalibrated, zoom z shows z screen px per canvas px.
    expect(preview.zoom()).toBeLessThanOrEqual(Math.min(1000 / 3178.58, 800 / 4493.86) + 1e-6);
    expect(preview.zoom()).toBeGreaterThanOrEqual(0.1);
  });

  it("7.2d Mod+wheel multiplies the zoom by 1.1 per step, in and out", async () => {
    const { host, preview } = await open();
    preview.setZoom(1);
    wheel(frame(host), -100, { ctrlKey: true });
    expect(preview.zoom()).toBeCloseTo(1.1, 6);
    wheel(frame(host), 100, { metaKey: true });
    expect(preview.zoom()).toBeCloseTo(1, 6);
  });

  it("7.2d a wheel without Mod does not zoom", async () => {
    const { host, preview } = await open();
    preview.setZoom(1);
    wheel(frame(host), -100);
    expect(preview.zoom()).toBe(1);
  });

  it("7.2d zoom stays within 10%..400%", async () => {
    const { host, preview } = await open();
    preview.setZoom(3.9);
    for (let i = 0; i < 3; i += 1) wheel(frame(host), -100, { ctrlKey: true });
    expect(preview.zoom()).toBe(4);
    preview.setZoom(0.105);
    for (let i = 0; i < 3; i += 1) wheel(frame(host), 100, { ctrlKey: true });
    expect(preview.zoom()).toBe(0.1);
    preview.setZoom(10);
    expect(preview.zoom()).toBe(4);
    preview.setZoom(0.01);
    expect(preview.zoom()).toBe(0.1);
  });

  it("7.2d a drag pans the poster without changing the zoom and re-renders the rulers", async () => {
    const { host, preview } = await open();
    preview.setZoom(1);
    await settle();
    const zoom = preview.zoom();
    const layoutBefore = layoutSignature(host);
    const rulerBefore = rulerHtml(host);
    drag(frame(host), [500, 400], [380, 250]);
    await settle();
    expect(preview.zoom()).toBe(zoom);
    expect(layoutSignature(host)).not.toBe(layoutBefore);
    expect(rulerHtml(host)).not.toBe(rulerBefore);
  });

  it("7.2d the unit toggle switches the ruler labels between mm and in", async () => {
    const { host } = await open();
    const mm = rulerLabels(host);
    expect(mm.length).toBeGreaterThan(0);
    expect(mm.every((n) => n % 10 === 0)).toBe(true);
    toggleUnit(host, "in");
    await settle();
    expect(rulerLabels(host).some((n) => n % 10 !== 0)).toBe(true);
    toggleUnit(host, "mm");
    await settle();
    expect(rulerLabels(host).every((n) => n % 10 === 0)).toBe(true);
  });

  it("7.2d the unit toggle carries aria-pressed", async () => {
    const { host } = await open();
    const toggles = Array.from(host.querySelectorAll("button")).filter((b) => ["mm", "in"].includes(accessibleName(b)));
    expect(toggles.length).toBeGreaterThan(0);
    for (const t of toggles) expect(["true", "false"]).toContain(t.getAttribute("aria-pressed"));
  });
});

// --- 7.2e ---------------------------------------------------------------------------------------------------------------------------

describe("poster preview small text", () => {
  it("7.2e smallText lists the leaves below the threshold in leaf order with their pt size", async () => {
    const { preview } = await open();
    const flags = preview.smallText();
    expect(flags.map(({ block, leaf, pt }) => ({ block, leaf, pt }))).toEqual([
      { block: "title", leaf: 1, pt: 12 },
      { block: "body", leaf: 1, pt: 15 },
    ]);
    expect(flags[1]!.text.startsWith("Tiny caption")).toBe(true);
  });

  it("7.2e the list shows each flag as '<pt> pt: <first 40 chars>' under 'Text below <threshold> pt'", async () => {
    const { host } = await open();
    const list = host.querySelector("[data-small-text]");
    expect(list).not.toBeNull();
    expect(list!.textContent).toContain(`15 pt: ${CAPTION.slice(0, 40)}`);
    expect(list!.textContent).not.toContain("forty characters");
    expect(list!.textContent).toContain("12 pt: Affiliation");
    expect(host.textContent).toContain("Text below 24 pt");
  });

  it("7.2e text at or above the threshold is not listed", async () => {
    const { host } = await open();
    const list = host.querySelector("[data-small-text]")!.textContent ?? "";
    for (const text of ["Readable text", "Edge case text", "Poster title"]) expect(list).not.toContain(text);
  });

  it("7.2e says 'No text below <threshold> pt' when nothing is flagged", async () => {
    const { host, preview } = await open({ html: LARGE_POSTER });
    expect(preview.smallText()).toEqual([]);
    expect(host.textContent).toContain("No text below 24 pt");
  });

  it("7.2e marks each flagged leaf with an element on the canvas", async () => {
    const outside = (host: HTMLElement) => Array.from(host.querySelectorAll("*")).filter((el) => !el.closest("[data-small-text]") && !el.closest("svg")).length;
    const flagged = await open();
    const clean = await open({ html: LARGE_POSTER });
    expect(outside(flagged.host) - outside(clean.host)).toBeGreaterThanOrEqual(2);
  });

  it("7.2e clicking a list entry calls onSelectLeaf with its block and leaf", async () => {
    const { host, onSelectLeaf } = await open();
    const list = host.querySelector("[data-small-text]")!;
    const entry = Array.from(list.querySelectorAll<HTMLElement>("*")).reverse().find((el) => (el.textContent ?? "").includes("15 pt:"));
    entry!.click();
    expect(onSelectLeaf).toHaveBeenCalledWith("body", 1);
  });

  it("7.2e refuses a talk with 'Poster preview needs a poster'", async () => {
    const host = makeHost();
    await expect(openPosterPreview(host, { html: TALK, theme: THEME, store: fakeStore(), resolveAsset: async (p) => p })).rejects.toThrow("Poster preview needs a poster");
  });

  it("7.2e the preview uses no style= attribute", async () => {
    const markup = watchStyleMarkup();
    try {
      const { host, preview } = await open();
      preview.setZoom(1.5);
      drag(frame(host), [500, 400], [450, 350]);
      await settle();
      expect(markup.writes).toEqual([]);
    } finally {
      markup.restore();
    }
  });
});

// --- A6 -----------------------------------------------------------------------------------------------------------------------------

describe("poster preview", () => {
  it("A6 shows the calibrated ruler in mm and in and flags text below the size threshold", async () => {
    const { host, preview } = await open({ store: fakeStore({ pxPerMm: 2 * DEFAULT_PX_PER_MM, measuredAt: NOW }) });
    expect(preview.calibrated()).toBe(true);
    expect(host.textContent).not.toContain("Not calibrated");
    preview.setZoom(1);
    await settle();
    expect(rulerLabels(host).some((n) => n % 100 !== 0)).toBe(true);
    preview.setUnit("in");
    await settle();
    expect(rulerLabels(host).some((n) => n % 10 !== 0)).toBe(true);
    expect(preview.smallText().map((f) => f.pt)).toEqual([12, 15]);
    expect(host.querySelector("[data-small-text]")!.textContent).toContain("15 pt:");
  });
});
