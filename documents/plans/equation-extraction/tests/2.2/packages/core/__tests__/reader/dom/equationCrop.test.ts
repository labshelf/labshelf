/** @jest-environment jsdom */
// Tests the equation box's pure steps: a dragged page rect becomes a PDF region, the page's text items inside it become one string,
// and the region is rendered to an un-themed PNG at high resolution (against a fake pdf.js page, no real rendering).
//
// Assumptions: a PageRect is in page fractions (0..1, origin top-left) as in textBoxPlacement; the viewport passed to pageRectToPdfRegion
// has width and height in pixels like a pdf.js PageViewport; a text item is a pdf.js item (str, transform, width, height) with its
// baseline origin at transform[4], transform[5]; the PNG comes out of the canvas (toDataURL or toBlob, both stubbed here).
import { pageRectToPdfRegion, textInRegion, renderRegionPng } from "../../../src/reader/dom/equationCrop";

type Viewport = Parameters<typeof pageRectToPdfRegion>[1];
type Page = Parameters<typeof renderRegionPng>[0];
type Items = Parameters<typeof textInRegion>[0];

const PAGE_W = 600;
const PAGE_H = 800;

interface ViewportParams { scale: number; offsetX?: number; offsetY?: number; rotation?: number }

/** A pdf.js-like viewport of a 600x800 pt page with viewBox [0,0,600,800]; rotation 0 or 90 as pdf.js maps them. */
function fakeViewport(params: ViewportParams, pageRotate = 0) {
  const { scale, offsetX = 0, offsetY = 0 } = params;
  const rotation = ((params.rotation ?? pageRotate) % 360 + 360) % 360;
  const rotated = rotation === 90;
  return {
    params,
    scale,
    rotation,
    viewBox: [0, 0, PAGE_W, PAGE_H],
    width: (rotated ? PAGE_H : PAGE_W) * scale,
    height: (rotated ? PAGE_W : PAGE_H) * scale,
    convertToViewportPoint(x: number, y: number): [number, number] {
      return rotated ? [y * scale + offsetX, x * scale + offsetY] : [x * scale + offsetX, (PAGE_H - y) * scale + offsetY];
    },
    convertToPdfPoint(x: number, y: number): [number, number] {
      return rotated ? [(y - offsetY) / scale, (x - offsetX) / scale] : [(x - offsetX) / scale, PAGE_H - (y - offsetY) / scale];
    },
  };
}

describe("2.2a pageRectToPdfRegion", () => {
  const rect = { x: 0.1, y: 0.25, w: 0.5, h: 0.1 };

  it("2.2a converts a page rect to a PDF region at rotation 0 (y up, yTop above yBottom)", () => {
    const region = pageRectToPdfRegion(rect, fakeViewport({ scale: 1.5 }) as unknown as Viewport);
    expect(region.x0).toBeCloseTo(60, 3);
    expect(region.x1).toBeCloseTo(360, 3);
    expect(region.yTop).toBeCloseTo(600, 3);
    expect(region.yBottom).toBeCloseTo(520, 3);
  });

  it("2.2a converts a page rect to a PDF region at rotation 90", () => {
    const region = pageRectToPdfRegion(rect, fakeViewport({ scale: 1.5 }, 90) as unknown as Viewport);
    expect(region.x0).toBeCloseTo(150, 3);
    expect(region.x1).toBeCloseTo(210, 3);
    expect(region.yTop).toBeCloseTo(480, 3);
    expect(region.yBottom).toBeCloseTo(80, 3);
  });

  it("2.2a gives the same region at any zoom", () => {
    const a = pageRectToPdfRegion(rect, fakeViewport({ scale: 1 }) as unknown as Viewport);
    const b = pageRectToPdfRegion(rect, fakeViewport({ scale: 2.5 }) as unknown as Viewport);
    expect(b.x0).toBeCloseTo(a.x0, 3);
    expect(b.x1).toBeCloseTo(a.x1, 3);
    expect(b.yTop).toBeCloseTo(a.yTop, 3);
    expect(b.yBottom).toBeCloseTo(a.yBottom, 3);
  });
});

describe("2.2a textInRegion", () => {
  const region = { x0: 100, x1: 300, yTop: 500, yBottom: 450 };
  const item = (str: string, x: number, y: number, width = 10, height = 10) => ({ str, transform: [10, 0, 0, 10, x, y], width, height });

  it("2.2a orders items top to bottom then left to right and joins them with spaces", () => {
    const items = [item("=", 120, 465), item("m", 200, 485), item("c", 150, 465), item("E", 110, 485)];
    expect(textInRegion(items as unknown as Items, region)).toBe("E m = c");
  });

  it("2.2a drops items outside the region", () => {
    const items = [item("in", 110, 470), item("right", 400, 470), item("below", 110, 300), item("above", 110, 700), item("left", 20, 470)];
    expect(textInRegion(items as unknown as Items, region)).toBe("in");
  });

  it("2.2a keeps an item overlapping the region by half and drops one overlapping by a quarter", () => {
    // Horizontal: the region ends at x 300; an item 20 wide starting at 290 has half inside, starting at 295 a quarter.
    expect(textInRegion([item("half", 290, 470, 20)] as unknown as Items, region)).toBe("half");
    expect(textInRegion([item("quarter", 295, 470, 20)] as unknown as Items, region)).toBe("");
    // Vertical: the region's top is 500; an item 10 tall with its baseline at 495 has half inside, at 497.5 a quarter.
    expect(textInRegion([item("half", 150, 495)] as unknown as Items, region)).toBe("half");
    expect(textInRegion([item("quarter", 150, 497.5)] as unknown as Items, region)).toBe("");
  });

  it("2.2a returns an empty string when nothing is inside", () => {
    expect(textInRegion([], region)).toBe("");
    expect(textInRegion([item("far", 500, 100)] as unknown as Items, region)).toBe("");
  });
});

describe("renderRegionPng", () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);
  const originals = {
    getContext: HTMLCanvasElement.prototype.getContext,
    toDataURL: HTMLCanvasElement.prototype.toDataURL,
    toBlob: HTMLCanvasElement.prototype.toBlob,
    arrayBuffer: (Blob.prototype as { arrayBuffer?: unknown }).arrayBuffer,
  };

  beforeEach(() => {
    const noopContext = (canvas: HTMLCanvasElement) => new Proxy({ canvas }, { get: (t, k) => (k in t ? (t as Record<PropertyKey, unknown>)[k] : () => undefined), set: () => true });
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) { return noopContext(this); } as never;
    HTMLCanvasElement.prototype.toDataURL = (() => `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`) as never;
    HTMLCanvasElement.prototype.toBlob = function (cb: (b: Blob | null) => void) { cb(new Blob([PNG], { type: "image/png" })); } as never;
    if (typeof Blob.prototype.arrayBuffer !== "function") {
      Blob.prototype.arrayBuffer = function (this: Blob) {
        return new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(this);
        });
      };
    }
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originals.getContext;
    HTMLCanvasElement.prototype.toDataURL = originals.toDataURL;
    HTMLCanvasElement.prototype.toBlob = originals.toBlob;
    (Blob.prototype as { arrayBuffer?: unknown }).arrayBuffer = originals.arrayBuffer;
  });

  interface Render { args: Record<string, unknown>; canvas: { width: number; height: number }; viewport: ReturnType<typeof fakeViewport> }

  function fakePage(pageRotate = 0) {
    const renders: Render[] = [];
    const page = {
      rotate: pageRotate,
      getViewport: (params: ViewportParams) => fakeViewport(params, pageRotate),
      render: (args: Record<string, unknown>) => {
        const canvas = (args["canvas"] ?? (args["canvasContext"] as { canvas: unknown }).canvas) as HTMLCanvasElement;
        renders.push({ args, canvas: { width: canvas.width, height: canvas.height }, viewport: args["viewport"] as Render["viewport"] });
        return { promise: Promise.resolve(), cancel: () => undefined };
      },
    };
    return { page: page as unknown as Page, renders };
  }

  const region = { x0: 100, x1: 300, yTop: 600, yBottom: 500 };

  it("2.2b returns the PNG bytes of the rendered canvas", async () => {
    const { page } = fakePage();
    const png = await renderRegionPng(page, region, { targetWidth: 1200 });
    expect(png).toBeInstanceOf(Uint8Array);
    expect(Array.from(png)).toEqual(Array.from(PNG));
  });

  it("2.2b renders once, without pageColors, so the page is black on white", async () => {
    const { page, renders } = fakePage();
    await renderRegionPng(page, region, { targetWidth: 1200 });
    expect(renders).toHaveLength(1);
    expect(renders[0]!.args["pageColors"]).toBeUndefined();
  });

  it("2.2b sizes the canvas to the target width, keeping the box's aspect ratio", async () => {
    const { page, renders } = fakePage();
    await renderRegionPng(page, region, { targetWidth: 1200 });
    expect(renders[0]!.canvas.width).toBeGreaterThanOrEqual(1199);
    expect(renders[0]!.canvas.width).toBeLessThanOrEqual(1201);
    expect(renders[0]!.canvas.height).toBeGreaterThanOrEqual(599);
    expect(renders[0]!.canvas.height).toBeLessThanOrEqual(601);
  });

  it("2.2b renders only the box: the viewport maps the region's corners onto the canvas edges", async () => {
    const { page, renders } = fakePage();
    await renderRegionPng(page, region, { targetWidth: 1200 });
    const { viewport, canvas } = renders[0]!;
    const [ax, ay] = viewport.convertToViewportPoint(region.x0, region.yTop);
    const [bx, by] = viewport.convertToViewportPoint(region.x1, region.yBottom);
    expect(ax).toBeCloseTo(0, 0);
    expect(ay).toBeCloseTo(0, 0);
    expect(bx).toBeCloseTo(canvas.width, 0);
    expect(by).toBeCloseTo(canvas.height, 0);
  });

  it("2.2b maps the corners onto the canvas edges on a rotated page, with the box's on-screen width as the width", async () => {
    // Rotation 90: the on-screen box is 200 wide (the y span) and 50 tall (the x span).
    const { page, renders } = fakePage(90);
    const rotated = { x0: 100, x1: 150, yTop: 600, yBottom: 400 };
    await renderRegionPng(page, rotated, { targetWidth: 1000 });
    const { viewport, canvas } = renders[0]!;
    expect(canvas.width).toBeGreaterThanOrEqual(999);
    expect(canvas.width).toBeLessThanOrEqual(1001);
    expect(canvas.height).toBeGreaterThanOrEqual(249);
    expect(canvas.height).toBeLessThanOrEqual(251);
    const a = viewport.convertToViewportPoint(rotated.x0, rotated.yTop);
    const b = viewport.convertToViewportPoint(rotated.x1, rotated.yBottom);
    expect(Math.min(a[0], b[0])).toBeCloseTo(0, 0);
    expect(Math.min(a[1], b[1])).toBeCloseTo(0, 0);
    expect(Math.max(a[0], b[0])).toBeCloseTo(canvas.width, 0);
    expect(Math.max(a[1], b[1])).toBeCloseTo(canvas.height, 0);
  });

  it("2.2b raises a small target width to at least 600 px", async () => {
    const { page, renders } = fakePage();
    await renderRegionPng(page, region, { targetWidth: 200 });
    expect(renders[0]!.canvas.width).toBeGreaterThanOrEqual(599);
    expect(renders[0]!.canvas.width).toBeLessThanOrEqual(601);
  });

  it("2.2b caps the canvas at 4 Mpx by default, keeping the aspect ratio", async () => {
    const { page, renders } = fakePage();
    const square = { x0: 100, x1: 300, yTop: 600, yBottom: 400 };
    await renderRegionPng(page, square, { targetWidth: 5000 });
    const { width, height } = renders[0]!.canvas;
    expect(width * height).toBeLessThanOrEqual(4_000_000);
    expect(width * height).toBeGreaterThan(3_500_000);
    expect(Math.abs(width - height)).toBeLessThanOrEqual(2);
  });

  it("2.2b caps the canvas at the maxPixels option", async () => {
    const { page, renders } = fakePage();
    const square = { x0: 100, x1: 300, yTop: 600, yBottom: 400 };
    await renderRegionPng(page, square, { targetWidth: 2000, maxPixels: 1_000_000 });
    const { width, height } = renders[0]!.canvas;
    expect(width * height).toBeLessThanOrEqual(1_000_000);
    expect(width * height).toBeGreaterThan(850_000);
  });

  it("2.2b without options still renders at least 600 px wide and within the 4 Mpx cap", async () => {
    const { page, renders } = fakePage();
    await renderRegionPng(page, { x0: 100, x1: 500, yTop: 600, yBottom: 550 });
    const { width } = renders[0]!.canvas;
    expect(width).toBeGreaterThanOrEqual(600);
    expect(width * renders[0]!.canvas.height).toBeLessThanOrEqual(4_000_000);
  });
});
