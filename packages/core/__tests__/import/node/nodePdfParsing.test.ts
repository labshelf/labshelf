/** PdfImportParser over the Node opener, with pdf.js replaced by the Jest mock. */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { PdfImportParser } from '../../../src/index.js';
import { NodePdfOpener, createPdfjsLoader } from '../../../src/import/node/index.js';

const globals = globalThis as Record<string, unknown>;

describe('PdfImportParser with the Node opener', () => {
  let parser: PdfImportParser;

  beforeEach(() => {
    delete globals['pdfjsWorker'];
    parser = new PdfImportParser(new NodePdfOpener(createPdfjsLoader()));
  });

  it('registers an in-process worker before parsing', async () => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, '../../fixtures/sample-valid.pdf')));

    const result = await parser.parse(bytes, 'sample-valid');

    expect(result.title).toBeTruthy();
    expect((globals['pdfjsWorker'] as { WorkerMessageHandler?: unknown } | undefined)?.WorkerMessageHandler).toBeDefined();
  });

  it('rejects content without a PDF header', async () => {
    await expect(parser.parse(new TextEncoder().encode('Not a PDF document at all'), 'plain')).rejects.toThrow();
  });

  it('rejects a PDF pdf.js cannot read', async () => {
    await expect(parser.parse(new TextEncoder().encode('%PDF-corrupted data'), 'corrupt')).rejects.toThrow();
  });
});
