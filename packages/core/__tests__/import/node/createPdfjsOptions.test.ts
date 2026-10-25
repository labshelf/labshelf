/** The getDocument options every Node caller gets: quiet, eval-free, with pdf.js' data files read from disk. */
import * as fs from 'node:fs';

import { createPdfjsLoader } from '../../../src/import/node/index.js';
import { createPdfjsOptions } from '../../../src/import/node/createPdfjsOptions.js';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfjsMock = require('../../../__mocks__/pdfjs-dist-legacy.js');

describe('createPdfjsOptions', () => {
  it('points at the CMap, standard-font and wasm tables shipped with pdfjs-dist', () => {
    const options = createPdfjsOptions();

    for (const key of ['cMapUrl', 'standardFontDataUrl', 'wasmUrl']) {
      expect(fs.existsSync(options[key] as string)).toBe(true);
      expect(options[key]).toMatch(/[\\/]$/);
    }
    expect(options['cMapPacked']).toBe(true);
    expect(options['useWorkerFetch']).toBe(false);
  });

  it('is quiet and never evaluates generated code', () => {
    expect(createPdfjsOptions()).toMatchObject({ verbosity: 0, isEvalSupported: false });
  });
});

describe('loader getDocument options', () => {
  const realGetDocument = pdfjsMock.getDocument;
  let seen: Record<string, unknown> | undefined;

  beforeEach(() => {
    seen = undefined;
    pdfjsMock.getDocument = jest.fn((options: Record<string, unknown>) => {
      seen = options;
      return realGetDocument({ data: new Uint8Array(200) });
    });
  });

  afterEach(() => {
    pdfjsMock.getDocument = realGetDocument;
  });

  it.each([
    ['without shims', undefined],
    ['with Electron shims', { electronShims: true }],
  ])('passes verbosity 0 and isEvalSupported false %s', async (_name, options) => {
    await createPdfjsLoader(options).getDocument({ data: new Uint8Array(1) });

    expect(seen).toMatchObject({ verbosity: 0, isEvalSupported: false, useWorkerFetch: false });
  });

  it('lets the caller override a default', async () => {
    await createPdfjsLoader().getDocument({ data: new Uint8Array(1), verbosity: 5 });

    expect(seen?.['verbosity']).toBe(5);
  });
});
