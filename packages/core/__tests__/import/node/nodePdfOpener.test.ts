/**
 * pdf.js takes ownership of the `data` array it is given and detaches it, so a caller that parses a PDF before copying
 * it to disk ends up writing zero bytes. The opener hands pdf.js a private copy, and restores the destroy() that
 * pdf.js 6 removed from documents.
 */
import { NodePdfOpener, createPdfjsLoader } from '../../../src/import/node/index.js';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfjsMock = require('../../../__mocks__/pdfjs-dist-legacy.js');

// Mirrors how pdf.js disposes of the buffer it was handed.
function detach(bytes: Uint8Array): void {
  const buffer = bytes.buffer as ArrayBuffer;
  structuredClone(buffer, { transfer: [buffer] });
}

describe('NodePdfOpener', () => {
  const realGetDocument = pdfjsMock.getDocument;

  afterEach(() => {
    pdfjsMock.getDocument = realGetDocument;
  });

  it('leaves the caller-owned array readable after pdf.js consumes its copy', async () => {
    pdfjsMock.getDocument = jest.fn(({ data }: { data: Uint8Array }) => {
      detach(data);
      return realGetDocument({ data: new Uint8Array(200) });
    });

    const bytes = new Uint8Array(512).fill(7);
    await new NodePdfOpener(createPdfjsLoader()).open(bytes);

    expect(bytes.byteLength).toBe(512);
    expect(bytes[0]).toBe(7);
  });

  it('hands pdf.js a private copy rather than the caller array', async () => {
    const seen: Uint8Array[] = [];
    pdfjsMock.getDocument = jest.fn(({ data }: { data: Uint8Array }) => {
      seen.push(data);
      return realGetDocument({ data });
    });

    const bytes = new Uint8Array(512).fill(3);
    await new NodePdfOpener(createPdfjsLoader()).open(bytes);

    expect(seen[0]).not.toBe(bytes);
    expect(Array.from(seen[0]!.slice(0, 4))).toEqual([3, 3, 3, 3]);
  });

  it('closes a document without destroy() through its loading task', async () => {
    const destroy = jest.fn(async () => undefined);
    pdfjsMock.getDocument = jest.fn(() => ({ promise: Promise.resolve({ numPages: 1 }), destroy }));

    const document = await new NodePdfOpener(createPdfjsLoader()).open(new Uint8Array(200));
    await document.destroy();

    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
