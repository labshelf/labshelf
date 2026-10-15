// Page-text and link extraction keep page numbers, collapse whitespace, cap the page count and log what cannot be read.
import type { ILogger, PdfDocumentLike } from '@labshelf/core';

import { extractLinkUrls, extractPageTexts } from '../../../src/import/pdf/textExtraction';

type PageSpec = string[] | Error;

function documentOf(pages: PageSpec[]): PdfDocumentLike {
  return {
    numPages: pages.length,
    getMetadata: async () => undefined,
    getPage: async (n: number) => {
      const spec = pages[n - 1] as PageSpec;
      if (spec instanceof Error) throw spec;
      return { getTextContent: async () => ({ items: spec.map((str) => ({ str })) }) };
    },
    destroy: () => undefined,
  } as unknown as PdfDocumentLike;
}

function loggerStub(): { logger: ILogger; log: jest.Mock } {
  const log = jest.fn(async () => undefined);
  return { logger: { log, error: jest.fn(async () => undefined) } as unknown as ILogger, log };
}

describe('extractPageTexts', () => {
  it('keeps each page number and skips pages without text', async () => {
    const { logger } = loggerStub();
    const pages = await extractPageTexts(documentOf([['alpha'], [' '], ['gamma', 'delta']]), 10, logger);

    expect(pages).toEqual([
      { page: 1, text: 'alpha' },
      { page: 3, text: 'gamma delta' },
    ]);
  });

  it('collapses newlines and repeated spaces inside a text item', async () => {
    const { logger } = loggerStub();
    const pages = await extractPageTexts(documentOf([['one\n  two\t\tthree', 'four']]), 10, logger);

    expect(pages).toEqual([{ page: 1, text: 'one two three four' }]);
  });

  it('reads no more than the requested number of pages', async () => {
    const { logger } = loggerStub();
    const pages = await extractPageTexts(documentOf([['a'], ['b'], ['c']]), 2, logger);

    expect(pages.map((p) => p.page)).toEqual([1, 2]);
  });

  it('logs a failing page with its number and still returns the others', async () => {
    const { logger, log } = loggerStub();
    const pages = await extractPageTexts(documentOf([['a'], new Error('bad xref'), ['c']]), 10, logger);

    expect(pages).toEqual([
      { page: 1, text: 'a' },
      { page: 3, text: 'c' },
    ]);
    expect(log).toHaveBeenCalledWith(
      'WARN',
      'import/pdf',
      expect.stringContaining('Page text unreadable'),
      expect.objectContaining({ page: 2, message: 'bad xref' }),
    );
  });
});

describe('extractLinkUrls', () => {
  it('logs a page whose annotations are unreadable and keeps the other pages', async () => {
    const { logger, log } = loggerStub();
    const annotations = [
      async () => [{ url: 'https://doi.org/10.1/a' }],
      async () => { throw new Error('bad annots'); },
      async () => [{ unsafeUrl: ' https://example.org/b ' }],
    ];
    const document = {
      numPages: 3,
      getPage: async (n: number) => ({ getAnnotations: annotations[n - 1] }),
    } as unknown as PdfDocumentLike;

    const urls = await extractLinkUrls(document, 3, logger);

    expect(urls).toEqual(['https://doi.org/10.1/a', 'https://example.org/b']);
    expect(log).toHaveBeenCalledWith('WARN', 'import/pdf', expect.stringContaining('annotations unreadable'), { page: 2, message: 'bad annots' });
  });
});
