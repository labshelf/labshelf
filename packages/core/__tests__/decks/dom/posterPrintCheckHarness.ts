// Shared fakes and helpers of posterPrintCheck.test.ts: a fake pdf.js with operator lists, the srcdoc shim with test rects, the preview host, fake frames and PDF decks.
import { openContentPosterPreview, type CanvasRect, type MountedPoster, type PosterContent, type PosterPreviewController, type SmallTextFlag } from "../../../src/decks/dom/openPosterPreview";
import type { DeckFrame } from "../../../src/decks/dom/deckFrame";
import { pdfPosterContent, type PdfDeck, type PdfTextRun } from "../../../src/decks/dom/pdfDeck";
import type { PrintBox, PrintCheckInput } from "../../../src/decks/deckPrintCheck";
import type { PdfImagePlacement } from "../../../src/decks/deckPrintCheckPdf";
import type { CalibrationStore, PosterCalibration } from "../../../src/decks/posterMeasure";

// --- a fake pdf.js with operator lists ------------------------------------------------------------------------------------------------

export const mockOps = {
  list: undefined as unknown,
  fail: false,
  calls: 0,
  reset(): void { this.list = { fnArray: [], argsArray: [] }; this.fail = false; this.calls = 0; },
};

jest.mock("fake-pdfjs-ops", () => {
  const OPS = { save: 10, restore: 11, transform: 12, paintFormXObjectBegin: 13, paintFormXObjectEnd: 14, paintImageXObject: 15, paintInlineImageXObject: 16 };
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }),
    getTextContent: async () => ({ items: [] }),
    getOperatorList: async () => {
      mockOps.calls++;
      if (mockOps.fail) throw new Error("operator list failed");
      return mockOps.list;
    },
    render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
  };
  const doc = { numPages: 1, getPage: async () => page, getPageLabels: async () => null };
  return { GlobalWorkerOptions: {}, OPS, getDocument: () => ({ promise: Promise.resolve(doc), destroy: async () => undefined }) };
}, { virtual: true });

export const OP = { save: 10, restore: 11, transform: 12, paintImageXObject: 15 };

// --- srcdoc shim (as in openPosterPreview.test.ts) plus test rects and natural sizes -----------------------------------------------------

const written = new WeakMap<HTMLIFrameElement, string>();
let observer: MutationObserver | undefined;

/** Gives each [data-test-rect="l,t,w,h"] element that rect, and each [data-natural="WxH"] image its natural size. */
function installMeasures(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[data-test-rect]"))) {
    const [l, t, w, h] = el.getAttribute("data-test-rect")!.split(",").map(Number) as [number, number, number, number];
    el.getBoundingClientRect = () => ({ x: l, y: t, left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, toJSON: () => ({}) }) as DOMRect;
  }
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[data-natural]"))) {
    const [w, h] = el.getAttribute("data-natural")!.split("x").map(Number) as [number, number];
    Object.defineProperty(el, "naturalWidth", { configurable: true, value: w });
    Object.defineProperty(el, "naturalHeight", { configurable: true, value: h });
  }
}

function loadSrcdocFrames(): void {
  for (const frame of Array.from(document.querySelectorAll("iframe"))) {
    const srcdoc = frame.getAttribute("srcdoc");
    const doc = frame.contentDocument;
    if (srcdoc == null || !doc || written.get(frame) === srcdoc) continue;
    written.set(frame, srcdoc);
    doc.open();
    doc.write(srcdoc);
    doc.close();
    installMeasures(doc);
    frame.dispatchEvent(new Event("load"));
  }
}

// --- harness -------------------------------------------------------------------------------------------------------------------------

export const opened: PosterPreviewController[] = [];

/** Registers the beforeAll, afterAll, beforeEach and afterEach hooks of the print check tests in the calling test file. */
export function installPosterPreviewHooks(): void {
  beforeAll(() => {
    const el = Element.prototype as unknown as Record<string, unknown>;
    el.setPointerCapture ??= () => undefined;
    el.releasePointerCapture ??= () => undefined;
    el.hasPointerCapture ??= () => false;
    observer = new MutationObserver(loadSrcdocFrames);
    observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["srcdoc"] });
    // jsdom has no 2D context; any object will do for the fake pdf.js.
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({}) as unknown as CanvasRenderingContext2D);
  });
  afterAll(() => observer?.disconnect());

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2026-03-04T05:06:07.000Z"));
    mockOps.reset();
  });

  afterEach(() => {
    for (const preview of opened) {
      try {
        preview.destroy();
      } catch {
        // already destroyed
      }
    }
    opened.length = 0;
    document.body.innerHTML = "";
    jest.useRealTimers();
  });
}

export async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    loadSrcdocFrames();
    await jest.advanceTimersByTimeAsync(0);
  }
}

export function fakeStore(): CalibrationStore {
  return { load: async (): Promise<PosterCalibration | undefined> => undefined, save: async () => undefined };
}

export function makeHost(): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { configurable: true, value: 1000 });
  Object.defineProperty(host, "clientHeight", { configurable: true, value: 800 });
  host.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, toJSON: () => ({}) }) as DOMRect;
  document.body.append(host);
  return host;
}

export const VIEW = { width: 976, height: 776 };
export const PX_PER_MM = 96 / 25.4;

export async function openContent(content: PosterContent): Promise<{ host: HTMLElement; preview: PosterPreviewController }> {
  const host = makeHost();
  const pending = openContentPosterPreview(host, { content, store: fakeStore() });
  await settle();
  const preview = await pending;
  opened.push(preview);
  await settle();
  return { host, preview };
}

/** A PosterContent of the given measured page (default A0) whose mounted poster gives input through printInput, when there is one. */
export function fakeContent(input: PrintCheckInput | undefined, flags: Array<SmallTextFlag & { rect: CanvasRect }> = []): PosterContent {
  const page = input?.page ?? { width: 841, height: 1189 };
  return {
    canvas: { width: page.width * PX_PER_MM, height: page.height * PX_PER_MM },
    thresholdPt: 24,
    mount: (): MountedPoster => ({ ready: Promise.resolve(), smallText: () => flags, destroy: () => undefined, ...(input ? { printInput: () => input } : {}) }),
  };
}

export const checkSection = (host: HTMLElement): HTMLElement | null => host.querySelector<HTMLElement>("[data-print-check]");
export const entries = (root: ParentNode): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>("button.ls-poster-print-entry"));
export const kindsOf = (root: ParentNode): Array<string | null> => entries(root).map((e) => e.getAttribute("data-print-kind"));
export const transformOf = (host: HTMLElement): { x: number; y: number; scale: number } => {
  const css = host.querySelector<HTMLElement>(".ls-poster-canvas")!.style.transform;
  const m = /translate\((-?[\d.e+-]+)px,\s*(-?[\d.e+-]+)px\)\s*scale\(([\d.e+-]+)\)/.exec(css);
  if (!m) throw new Error(`unreadable canvas transform: ${css}`);
  return { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) };
};
export function expectBox(actual: PrintBox, expected: [number, number, number, number], digits = 2): void {
  expect(actual.left).toBeCloseTo(expected[0], digits);
  expect(actual.top).toBeCloseTo(expected[1], digits);
  expect(actual.width).toBeCloseTo(expected[2], digits);
  expect(actual.height).toBeCloseTo(expected[3], digits);
}

// --- fake frames ---------------------------------------------------------------------------------------------------------------------

export const mm = (px: number): number => (px * 25.4) / 96;
export const rectOf = (l: number, t: number, w: number, h: number) => () => ({ x: l, y: t, left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, toJSON: () => ({}) }) as DOMRect;

/** A fake DeckFrame over a real frame document: leaves come from the given selectors, blocks from the data-block children of the slide. */
export function fakeFrame(body: string, leaves: Array<{ selector: string; block: string; index: number }> = []): { deckFrame: DeckFrame; doc: Document } {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head></head><body><section data-slide>${body}</section></body></html>`);
  doc.close();
  const deckFrame = {
    frame: iframe,
    ready: Promise.resolve(),
    blocks: () => Array.from(doc.querySelectorAll("[data-block]")).map((el) => ({ id: el.getAttribute("data-block")!, left: 0, top: 0, width: 1, height: 1 })),
    leaves: () => leaves.map(({ selector, block, index }) => ({ block, index, element: doc.querySelector<HTMLElement>(selector)! })),
    setSlide: async () => undefined,
    update: async () => undefined,
    destroy: () => undefined,
  } as unknown as DeckFrame;
  return { deckFrame, doc };
}

export function sizeImage(img: HTMLImageElement, natural: [number, number], rect: [number, number, number, number]): void {
  Object.defineProperty(img, "naturalWidth", { configurable: true, value: natural[0] });
  Object.defineProperty(img, "naturalHeight", { configurable: true, value: natural[1] });
  img.getBoundingClientRect = rectOf(...rect);
}

export const A0 = { width: 841, height: 1189 };

// --- fake PDF decks ------------------------------------------------------------------------------------------------------------------

// A 720 x 1008 pt page is 254 x 355.6 mm; 72 pt are 25.4 mm.
export const RUNS: PdfTextRun[] = [
  { text: "Title", pt: 24, left: 20, top: 72, width: 144 },
  { text: "ghost", pt: 0, left: 300, top: 300, width: 50 },
];
export const PLACEMENTS: PdfImagePlacement[] = [{ left: 300, top: 100, width: 72, height: 72, pixelWidth: 100, pixelHeight: 100 }];
export const PT = 25.4 / 72;

export function fakePdf(images?: PdfDeck["images"]): PdfDeck {
  const base: PdfDeck = {
    count: 1,
    labels: null,
    pageSize: () => ({ width: 720, height: 1008 }),
    render: async () => undefined,
    textRuns: async () => RUNS,
    destroy: () => undefined,
  };
  return images ? { ...base, images } : base;
}

export async function mountPdf(pdf: PdfDeck): Promise<{ poster: MountedPoster; input: PrintCheckInput }> {
  const content = pdfPosterContent(pdf);
  const poster = content.mount(document.createElement("div"));
  await poster.ready;
  expect(poster.printInput).toBeDefined();
  return { poster, input: poster.printInput!() };
}
