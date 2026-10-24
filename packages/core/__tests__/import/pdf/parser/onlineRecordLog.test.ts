// A registry search that throws is logged with context and the import goes on without an online record.
import type { ILogger, PdfDocumentOpener } from '@labshelf/core';

import { PdfImportParser } from '../../../../src/import/pdf/parser/PdfImportParser';

jest.mock('../../../../src/import/search/index', () => ({
  ...jest.requireActual('../../../../src/import/search/index'),
  searchOnlineByQueries: jest.fn(() => Promise.reject(new Error('search exploded'))),
}));

const PROSE =
  'We study the structure of the networks that we describe in this paper and we show that the results are ' +
  'stable with respect to the choice of the data that has been used for the experiments in the first part ' +
  'of this work, which are also the ones that we have reported by the authors in the other sections here.';

const opener: PdfDocumentOpener = {
  open: async () => ({
    numPages: 1,
    getMetadata: async () => ({ info: {} }),
    getPage: async () => ({
      getTextContent: async () => ({
        items: [
          { str: 'Deep Residual Learning for Image Recognition', transform: [20, 0, 0, 20, 0, 0] },
          { str: PROSE, transform: [10, 0, 0, 10, 0, 0] },
        ],
      }),
    }),
    destroy: () => undefined,
  }),
};

describe('PdfImportParser registry search', () => {
  it('logs the failure through the injected logger and still parses', async () => {
    const log = jest.fn(async () => undefined);
    const logger = { log, error: jest.fn(async () => undefined) } as unknown as ILogger;

    const result = await new PdfImportParser(opener, { logger }).parse(new TextEncoder().encode('%PDF-1.7 body'), 'stem');

    expect(result.title).toBeDefined();
    expect(log).toHaveBeenCalledWith('WARN', 'import/pdf', expect.stringContaining('Registry search failed'), { message: 'search exploded' });
  });
});
