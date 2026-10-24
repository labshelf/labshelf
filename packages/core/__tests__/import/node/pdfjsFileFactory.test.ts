/** The BinaryDataFactory that reads pdf.js' data files from disk when pdf.js does not detect Node. */
import * as fs from 'node:fs';

import { DiskBinaryDataFactory } from '../../../src/import/node/pdfjsFileFactory.js';
import { pdfjsDataOptions } from '../../../src/import/node/pdfjsOpenOptions.js';

describe('DiskBinaryDataFactory', () => {
  it('reads binary data from disk rather than over fetch()', async () => {
    const options = pdfjsDataOptions();
    const factory = new DiskBinaryDataFactory({ cMapUrl: options['cMapUrl'] as string });

    const filename = fs.readdirSync(options['cMapUrl'] as string).find((name) => name.endsWith('.bcmap'))!;
    const data = await factory.fetch({ kind: 'cMapUrl', filename });

    expect(data.byteLength).toBeGreaterThan(0);
  });

  it('names the missing API parameter when a root was not provided', async () => {
    const factory = new DiskBinaryDataFactory({});

    await expect(factory.fetch({ kind: 'wasmUrl', filename: 'jbig2.wasm' })).rejects.toThrow(/wasmUrl/);
  });
});
