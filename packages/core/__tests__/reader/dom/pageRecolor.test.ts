/**
 * @jest-environment jsdom
 */
// Tests the pdf.js hook of the page recolouring: which renders it takes over, and which canvases get their colours mapped.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { installPageRecolor, mapContextColour, prepareRender, RecolorCanvasFactory } from "../../../src/reader/dom/pageRecolor";

const DARK = { background: "#1e1e1e", foreground: "#e8e8e8" };

describe("prepareRender", () => {
  it("takes over a hue-keeping render: pdf.js gets no pageColors and the canvas maps colours", () => {
    const canvas = {};
    const params = prepareRender({ canvas: canvas as HTMLCanvasElement, pageColors: { ...DARK, keepHue: true } });
    expect(params.pageColors).toBeNull();
    expect(mapContextColour({ canvas }, "#ffffff")).toBe(DARK.background);
    expect(mapContextColour({ canvas }, "#000000")).toBe(DARK.foreground);
  });

  it("leaves high contrast to pdf.js and unmarks a canvas reused without a theme", () => {
    const canvas = {};
    prepareRender({ canvas: canvas as HTMLCanvasElement, pageColors: { ...DARK, keepHue: true } });
    const hc = { background: "#000000", foreground: "#ffffff", keepHue: false };
    expect(prepareRender({ canvas: canvas as HTMLCanvasElement, pageColors: hc }).pageColors).toBe(hc);
    expect(mapContextColour({ canvas }, "#000000")).toBe("#000000");
  });

  it("marks the canvas behind a passed context", () => {
    const canvas = {};
    prepareRender({ canvasContext: { canvas } as unknown as CanvasRenderingContext2D, pageColors: { ...DARK, keepHue: true } });
    expect(mapContextColour({ canvas }, "#ffffff")).toBe(DARK.background);
  });
});

describe("RecolorCanvasFactory", () => {
  it("gives a canvas created mid-render the recolouring of the context last drawn on", () => {
    const page = {};
    prepareRender({ canvas: page as HTMLCanvasElement, pageColors: { ...DARK, keepHue: true } });
    const factory = new RecolorCanvasFactory({ ownerDocument: document });
    mapContextColour({ canvas: page }, "#000000");
    const group = factory.create(4, 4);
    expect(mapContextColour({ canvas: group.canvas! }, "#000000")).toBe(DARK.foreground);
    mapContextColour({ canvas: {} }, "#000000");
    const plain = factory.create(4, 4);
    expect(mapContextColour({ canvas: plain.canvas! }, "#000000")).toBe("#000000");
  });
});

describe("installPageRecolor", () => {
  it("wraps the page class' render once, so every render goes through the takeover", async () => {
    const seen: unknown[] = [];
    class FakePage { render(params: unknown): unknown { seen.push(params); return params; } }
    const doc = { getPage: async () => new FakePage() } as unknown as PDFDocumentProxy;
    await installPageRecolor(doc);
    await installPageRecolor(doc);
    new FakePage().render({ canvas: {}, pageColors: { ...DARK, keepHue: true } });
    expect(seen).toHaveLength(1);
    expect((seen[0] as { pageColors: unknown }).pageColors).toBeNull();
  });
});
