// A failed identifier lookup is logged with context and parsing goes on without a confirmed identifier.
import type { ILogger, PdfOpener } from '@labshelf/core';

import { PdfImportParser } from '../../../../src/import/pdf/parser';

jest.mock('../../../../src/import/search/index', () => ({
  ...jest.requireActual('../../../../src/import/search/index'),
  resolveFirstIdentifier: jest.fn(() => Promise.reject(new Error('registry exploded'))),
}));

const opener: PdfOpener = {
  open: async () => ({
    numPages: 1,
    getMetadata: async () => ({ info: {} }),
    getPage: async () => ({
      getTextContent: async () => ({
        items: [{ str: 'See doi:10.1000/abc123 for the data of this study', transform: [10, 0, 0, 10, 0, 0] }],
      }),
    }),
    destroy: () => undefined,
  }),
};

describe('PdfImportParser identifier lookup', () => {
  it('logs the failure through the injected logger and still parses', async () => {
    const log = jest.fn(async () => undefined);
    const logger = { log, error: jest.fn(async () => undefined) } as unknown as ILogger;

    const result = await new PdfImportParser(opener, { logger }).parse(new TextEncoder().encode('%PDF-1.7 body'), 'stem');

    expect(result.title).toBeDefined();
    expect(log).toHaveBeenCalledWith(
      'WARN',
      'import/pdf',
      expect.stringContaining('Identifier lookup failed'),
      expect.objectContaining({ message: 'registry exploded', identifiers: ['10.1000/abc123'] }),
    );
  });
});
