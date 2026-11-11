/** The Node crop of a page region: its pixel size, the viewport offsets that put the box at the canvas origin, and the PDF's teardown; pdf.js is faked because Jest cannot load it. */
import { loadNativeCanvas } from "../../../src/import/node/nativeCanvas.js";
import { createNodePaperPdf, cropSize } from "../../../src/paperObjects/node/index.js";
import { readPngWidth } from "../../../src/templates/node/catalog.js";

const PAGE = { width: 600, height: 800 };

describe("cropSize", () => {
  it("is three times the box, at least 600 px wide, and at most four million pixels", () => {
    expect(cropSize(300, 100)).toEqual({ width: 900, height: 300 });
    expect(cropSize(50, 10)).toEqual({ width: 600, height: 120 });
    const big = cropSize(1000, 1000);
    expect(big.width * big.height).toBeLessThanOrEqual(4_000_000);
    expect(big.width).toBe(big.height);
  });
});

const describeWithCanvas = loadNativeCanvas() ? describe : describe.skip;

describeWithCanvas("createNodePaperPdf", () => {
  it("renders the box at the canvas origin as a PNG and closes the loading task", async () => {
    const viewports: Array<{ scale: number; offsetX?: number; offsetY?: number }> = [];
    const destroy = jest.fn(async () => undefined);
    const bytes = new Uint8Array([1, 2, 3]);
    let given: unknown;
    const page = {
      getViewport: (options: { scale: number; offsetX?: number; offsetY?: number }) => {
        viewports.push(options);
        return { width: PAGE.width * options.scale, height: PAGE.height * options.scale };
      },
      render: () => ({ promise: Promise.resolve() }),
      getTextContent: async () => ({ items: [] }),
    };
    const pdfjs = {
      load: async () => ({}),
      getDocument: async (options: Record<string, unknown>) => {
        given = options["data"];
        return { destroy, promise: Promise.resolve({ numPages: 1, getPage: async () => page }) } as never;
      },
    };
    const pdf = createNodePaperPdf(pdfjs);
    const open = await pdf.open(bytes);
    expect(given).not.toBe(bytes);
    const png = await pdf.renderRegion(open.doc, 1, { x: 0.1, y: 0.25, w: 0.5, h: 0.1 });
    expect(readPngWidth(Buffer.from(png))).toBe(900);
    expect(viewports.at(-1)).toEqual({ scale: 3, offsetX: -180, offsetY: -600 });
    await open.close();
    expect(destroy).toHaveBeenCalled();
  });
});
