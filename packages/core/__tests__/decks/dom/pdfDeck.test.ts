/** @jest-environment jsdom */
// Pages on the LaTeX/Typst stage draw whole: renders on one canvas are serialised so a newer render never resizes (clears) the canvas while
// an earlier pdf.js task still draws into it, the latest request paints, and a render error shows a note on the stage instead of vanishing.
// Acceptance id: A2. pdf.js is a fake module whose page renders are slow and whose cancel rejects a tick later, as pdf.js does.
import { openPdfDeck, type PdfDeck } from "../../../src/decks/dom/pdfDeck";
import { createStage } from "../../../src/decks/dom/workspace/stage";

interface FakeTask { page: number; cancelled: boolean }

/** What the fake pdf.js records and how it behaves; `mock` prefix so the jest.mock factory may reach it. */
const mockPdf = {
  inFlight: 0,
  started: [] as FakeTask[],
  painted: [] as number[],
  failWith: undefined as Error | undefined,
  reset(): void { this.inFlight = 0; this.started = []; this.painted = []; this.failWith = undefined; },
};

jest.mock("fake-pdfjs", () => {
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  const page = (n: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 50 * scale }),
    getTextContent: async () => ({ items: [] }),
    render: () => {
      const task: FakeTask = { page: n, cancelled: false };
      mockPdf.started.push(task);
      mockPdf.inFlight++;
      const promise = (async () => {
        try {
          for (let i = 0; i < 5; i++) {
            await wait(4);
            if (task.cancelled) throw Object.assign(new Error("cancelled"), { name: "RenderingCancelledException" });
          }
          if (mockPdf.failWith) throw mockPdf.failWith;
          mockPdf.painted.push(n);
        } finally {
          mockPdf.inFlight--;
        }
      })();
      return { promise, cancel: () => { task.cancelled = true; } };
    },
  });
  const doc = {
    numPages: 3,
    getPage: async (n: number) => { await wait(1); return page(n); },
    getPageLabels: async () => null,
  };
  return { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve(doc), destroy: async () => undefined }) };
}, { virtual: true });

const assets = { pdfjsUrl: "fake-pdfjs", workerUrl: "fake-worker" };
const source = { assets, readBytes: async () => new ArrayBuffer(1), createWorker: () => ({}) as Worker };
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A canvas that records each resize and whether a pdf.js task was drawing at that moment. */
function watchedCanvas(): { canvas: HTMLCanvasElement; resizes: Array<{ inFlight: number }> } {
  const canvas = document.createElement("canvas");
  const resizes: Array<{ inFlight: number }> = [];
  let width = 300;
  let height = 150;
  Object.defineProperty(canvas, "width", { get: () => width, set: (v: number) => { resizes.push({ inFlight: mockPdf.inFlight }); width = v; } });
  Object.defineProperty(canvas, "height", { get: () => height, set: (v: number) => { resizes.push({ inFlight: mockPdf.inFlight }); height = v; } });
  return { canvas, resizes };
}

beforeAll(() => {
  // jsdom has no 2D context; any object will do for the fake pdf.js.
  jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({}) as unknown as CanvasRenderingContext2D);
});

beforeEach(() => mockPdf.reset());

describe("PdfDeck.render on one canvas (A2)", () => {
  let deck: PdfDeck;
  beforeEach(async () => { deck = await openPdfDeck(source); });

  it("two renders started together paint only the latest page, once", async () => {
    const { canvas, resizes } = watchedCanvas();
    await Promise.all([deck.render(canvas, 0, 1), deck.render(canvas, 1, 2)]);
    expect(mockPdf.painted).toEqual([2]);
    expect(resizes.every((r) => r.inFlight === 0)).toBe(true);
    expect(canvas.width).toBe(200);
  });

  it("a render that arrives while a task draws waits for that task to settle before resizing the canvas", async () => {
    const { canvas, resizes } = watchedCanvas();
    const first = deck.render(canvas, 0, 1);
    await sleep(8);
    expect(mockPdf.inFlight).toBe(1);
    await Promise.all([first, deck.render(canvas, 2, 3)]);
    expect(mockPdf.painted).toEqual([3]);
    expect(mockPdf.started[0]?.cancelled).toBe(true);
    expect(resizes.length).toBeGreaterThan(0);
    expect(resizes.every((r) => r.inFlight === 0)).toBe(true);
    expect(canvas.width).toBe(300);
  });

  it("three overlapping renders: only the last one draws", async () => {
    const { canvas, resizes } = watchedCanvas();
    const first = deck.render(canvas, 0, 1);
    await sleep(8);
    await Promise.all([first, deck.render(canvas, 1, 1), deck.render(canvas, 2, 1)]);
    expect(mockPdf.painted).toEqual([3]);
    expect(mockPdf.started.map((t) => t.page)).toEqual([1, 3]);
    expect(resizes.every((r) => r.inFlight === 0)).toBe(true);
  });

  it("a render error that is not a cancellation reaches the caller", async () => {
    mockPdf.failWith = new Error("Image decode failed");
    await expect(deck.render(watchedCanvas().canvas, 0, 1)).rejects.toThrow("Image decode failed");
  });
});

describe("stage draw errors (A2)", () => {
  it("shows a one-line note on the stage and logs the pdf.js error", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    mockPdf.failWith = new Error("Image decode failed\nat somewhere");
    const stage = createStage({ pdf: { assets, read: async () => new ArrayBuffer(1), createWorker: () => ({}) as Worker } }, () => undefined);
    document.body.append(stage.element);
    expect(await stage.load()).toBe(true);
    await sleep(60);
    const note = stage.element.querySelector<HTMLElement>(".dw-stage-note")!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe("Page 1 could not be drawn: Image decode failed");
    expect(warn).toHaveBeenCalled();
    // The workspace's own note does not hide the error while it stands.
    stage.setNote("Following by page");
    expect(note.textContent).toBe("Page 1 could not be drawn: Image decode failed");
    stage.dispose();
    stage.element.remove();
    warn.mockRestore();
  });

  it("keeps the workspace note when the page draws", async () => {
    const stage = createStage({ pdf: { assets, read: async () => new ArrayBuffer(1), createWorker: () => ({}) as Worker } }, () => undefined);
    stage.setNote("Following by page");
    expect(await stage.load()).toBe(true);
    await sleep(60);
    const note = stage.element.querySelector<HTMLElement>(".dw-stage-note")!;
    expect(mockPdf.painted).toEqual([1]);
    expect(note.textContent).toBe("Following by page");
    expect(note.hidden).toBe(false);
    stage.dispose();
  });
});
