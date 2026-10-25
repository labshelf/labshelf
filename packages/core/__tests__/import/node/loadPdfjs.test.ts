/** The pdf.js loader: one import per loader, pdf.js before its in-process worker, shims only for Electron hosts. */
import { DiskBinaryDataFactory } from '../../../src/import/node/pdfjsFileFactory.js';
import { createPdfjsLoader } from '../../../src/import/node/index.js';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfjsMock = require('../../../__mocks__/pdfjs-dist-legacy.js');

const globals = globalThis as Record<string, unknown>;

describe('createPdfjsLoader', () => {
  const realGetDocument = pdfjsMock.getDocument;
  const savedDomMatrix = Object.getOwnPropertyDescriptor(globalThis, 'DOMMatrix');

  beforeEach(() => {
    delete globals['pdfjsWorker'];
    delete globals['DOMMatrix'];
    delete (pdfjsMock.GlobalWorkerOptions as { workerSrc?: string }).workerSrc;
  });

  afterEach(() => {
    pdfjsMock.getDocument = realGetDocument;
    delete globals['DOMMatrix'];
    if (savedDomMatrix) {
      Object.defineProperty(globalThis, 'DOMMatrix', savedDomMatrix);
    }
  });

  it('imports pdf.js once per loader', async () => {
    const loader = createPdfjsLoader();

    const first = loader.load();
    const second = loader.load();

    expect(second).toBe(first);
    expect(await first).toBe(await loader.load());
  });

  it('imports nothing until the first use', () => {
    createPdfjsLoader({ electronShims: true });

    expect(globals['pdfjsWorker']).toBeUndefined();
    expect(globals['DOMMatrix']).toBeUndefined();
  });

  it('registers the worker in-process and points workerSrc at it', async () => {
    await createPdfjsLoader().load();

    expect((globals['pdfjsWorker'] as { WorkerMessageHandler?: unknown }).WorkerMessageHandler).toBeDefined();
    expect(pdfjsMock.GlobalWorkerOptions.workerSrc).toBe('pdfjs-dist/legacy/build/pdf.worker.mjs');
  });

  it('keeps a worker the host already registered', async () => {
    const existing = { WorkerMessageHandler: class {} };
    globals['pdfjsWorker'] = existing;

    await createPdfjsLoader().load();

    expect(globals['pdfjsWorker']).toBe(existing);
  });

  it('imports pdf.js before its worker', async () => {
    const order: string[] = [];
    jest.isolateModules(() => {
      jest.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => {
        order.push('pdf');
        return { GlobalWorkerOptions: {}, getDocument: jest.fn() };
      });
      jest.doMock('pdfjs-dist/legacy/build/pdf.worker.mjs', () => {
        order.push('worker');
        return { WorkerMessageHandler: class {} };
      });
      const { createPdfjsLoader: isolated } = require('../../../src/import/node/loadPdfjs.js');
      return isolated().load();
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(order).toEqual(['pdf', 'worker']);
    jest.dontMock('pdfjs-dist/legacy/build/pdf.mjs');
    jest.dontMock('pdfjs-dist/legacy/build/pdf.worker.mjs');
  });

  describe('Electron shims', () => {
    it('install the DOMMatrix global before pdf.js loads, only when asked', async () => {
      await createPdfjsLoader().load();
      expect(globals['DOMMatrix']).toBeUndefined();

      await createPdfjsLoader({ electronShims: true }).load();
      expect(typeof globals['DOMMatrix']).toBe('function');
    });

    it('leave an existing DOMMatrix alone', async () => {
      class Existing {}
      globals['DOMMatrix'] = Existing;

      await createPdfjsLoader({ electronShims: true }).load();

      expect(globals['DOMMatrix']).toBe(Existing);
    });

    it('hand pdf.js a disk BinaryDataFactory, which plain Node does not need', async () => {
      const seen: Array<Record<string, unknown>> = [];
      pdfjsMock.getDocument = jest.fn((options: Record<string, unknown>) => {
        seen.push(options);
        return realGetDocument({ data: new Uint8Array(200) });
      });

      await createPdfjsLoader().getDocument({ data: new Uint8Array(1) });
      await createPdfjsLoader({ electronShims: true }).getDocument({ data: new Uint8Array(1) });

      expect(seen[0]).not.toHaveProperty('BinaryDataFactory');
      expect(seen[1]?.['BinaryDataFactory']).toBe(DiskBinaryDataFactory);
    });
  });
});
