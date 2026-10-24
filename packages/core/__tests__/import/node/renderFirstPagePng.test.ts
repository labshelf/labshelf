/** Rendering page 1 yields a PNG whose width is the one asked for, and leaves the caller's bytes intact; pdf.js is faked because Jest cannot load it. */
import { readPngWidth } from '../../../src/templates/node/catalog/pngWidth.js';
import { loadNativeCanvas } from '../../../src/import/node/nativeCanvas.js';

const PAGE_POINTS = { width: 612, height: 792 };
const destroy = jest.fn(async () => undefined);

jest.mock('../../../src/import/node/loadPdfjs.js', () => ({
  createPdfjsLoader: () => ({
    load: async () => ({}),
    getDocument: async () => ({
      destroy,
      promise: Promise.resolve({
        numPages: 3,
        getPage: async (number: number) => ({
          getViewport: ({ scale }: { scale: number }) => ({ width: PAGE_POINTS.width * scale, height: PAGE_POINTS.height * scale, number }),
          render: () => ({ promise: Promise.resolve() }),
          cleanup: () => undefined,
        }),
      }),
    }),
  }),
}));

const describeWithCanvas = loadNativeCanvas() ? describe : describe.skip;

describeWithCanvas('renderFirstPagePng', () => {
  it('returns a PNG of the requested width and destroys the loading task', async () => {
    const { renderFirstPagePng } = await import('../../../src/import/node/renderFirstPagePng.js');
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

    const png = await renderFirstPagePng(bytes, 480);

    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(readPngWidth(png)).toBe(480);
    expect(destroy).toHaveBeenCalled();
    expect(Array.from(bytes)).toEqual([0x25, 0x50, 0x44, 0x46]);
  });
});
