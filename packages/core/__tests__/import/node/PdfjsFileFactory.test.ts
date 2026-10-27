/** The BinaryDataFactory that reads pdf.js' data files from disk when pdf.js does not detect Node. */
import * as fs from 'node:fs';

import { PdfjsFileFactory, createPdfjsOptions } from '../../../src/import/node/pdfjs.js';

describe('DiskBinaryDataFactory', () => {
  it('reads binary data from disk rather than over fetch()', async () => {
    const options = createPdfjsOptions();
    const factory = new PdfjsFileFactory({ cMapUrl: options['cMapUrl'] as string });

    const filename = fs.readdirSync(options['cMapUrl'] as string).find((name) => name.endsWith('.bcmap'))!;
    const data = await factory.fetch({ kind: 'cMapUrl', filename });

    expect(data.byteLength).toBeGreaterThan(0);
  });

  it('names the missing API parameter when a root was not provided', async () => {
    const factory = new PdfjsFileFactory({});

    await expect(factory.fetch({ kind: 'wasmUrl', filename: 'jbig2.wasm' })).rejects.toThrow(/wasmUrl/);
  });
});
