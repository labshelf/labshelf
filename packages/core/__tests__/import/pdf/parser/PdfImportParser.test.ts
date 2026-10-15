/**
 * Characterization tests for PdfImportParser.parse: which sources it consults,
 * in which order, and how it grades and reports the record it builds.
 */

import { PdfImportParser, type PdfDocumentOpener, type PdfOcrEngine } from '@labshelf/core';

interface FakePage {
  items: Array<{ str: string; size?: number }>;
}

interface FakeFile {
  pages: FakePage[];
  info?: Record<string, unknown>;
}

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7 fake body');

function opener(file: FakeFile): PdfDocumentOpener {
  return {
    open: async () => ({
      numPages: file.pages.length,
      getMetadata: async () => ({ info: file.info ?? {} }),
      getPage: async (n: number) => ({
        getTextContent: async () => ({
          items: file.pages[n - 1]!.items.map(({ str, size = 10 }) => ({
            str,
            transform: [size, 0, 0, size, 0, 0],
          })),
        }),
      }),
      destroy: () => undefined,
    }),
  };
}

const PROSE =
  'We study the structure of the networks that we describe in this paper and we show that the results are ' +
  'stable with respect to the choice of the data that has been used for the experiments in the first part ' +
  'of this work, which are also the ones that we have reported by the authors in the other sections here.';

const TITLE = 'Deep Residual Learning for Image Recognition';

function titlePage(): FakePage {
  return {
    items: [
      { str: TITLE, size: 20 },
      { str: 'Kaiming He, Xiangyu Zhang, Shaoqing Ren, Jian Sun', size: 12 },
      { str: PROSE, size: 10 },
    ],
  };
}

type Route = (url: string) => unknown | undefined;

// Answers each registry URL from `routes`; every unmatched URL fails like an offline registry.
function stubRegistries(routes: Record<string, Route>): jest.Mock {
  const fetchMock = jest.fn(async (url: string) => {
    const host = Object.keys(routes).find((key) => String(url).includes(key));
    const body = host ? routes[host]!(String(url)) : undefined;
    return body === undefined
      ? { ok: false, text: async () => '' }
      : { ok: true, text: async () => JSON.stringify(body) };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const crossRefWork = {
  title: [TITLE],
  DOI: '10.1109/cvpr.2016.90',
  author: [{ given: 'Kaiming', family: 'He' }],
  issued: { 'date-parts': [[2016]] },
  'container-title': ['CVPR'],
};

describe('PdfImportParser.parse', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('confirms a DOI printed in the text against CrossRef and grades the record high', async () => {
    stubRegistries({ 'api.crossref.org/works/': () => ({ message: crossRefWork }) });
    const page = titlePage();
    page.items.push({ str: 'doi:10.1109/cvpr.2016.90', size: 10 });

    const result = await new PdfImportParser(opener({ pages: [page] })).parse(PDF_BYTES, 'resnet');

    expect(result).toMatchObject({
      title: TITLE,
      authors: ['Kaiming He'],
      year: 2016,
      doi: '10.1109/cvpr.2016.90',
      journal: 'CVPR',
      confidence: 'high',
      citeKey: '101109cvpr2016902016',
    });
    expect(result.source).toMatch(/^doi:10\.1109\/cvpr\.2016\.90 \(\d+ sources?\)$/);
  });

  it('searches the registries by the layout title when no identifier is printed', async () => {
    const fetchMock = stubRegistries({
      'api.crossref.org/works?': () => ({ message: { items: [crossRefWork] } }),
    });

    const result = await new PdfImportParser(opener({ pages: [titlePage()] })).parse(PDF_BYTES, 'resnet');

    expect(fetchMock).toHaveBeenCalled();
    expect(result).toMatchObject({ title: TITLE, doi: '10.1109/cvpr.2016.90', confidence: 'medium' });
    expect(result.source).toMatch(/^search:text/);
  });

  it('falls back to the layout title and byline when every registry fails', async () => {
    stubRegistries({});

    const result = await new PdfImportParser(opener({ pages: [titlePage()] })).parse(PDF_BYTES, 'resnet');

    expect(result).toMatchObject({
      title: TITLE,
      authors: ['Kaiming He', 'Xiangyu Zhang', 'Shaoqing Ren', 'Jian Sun'],
      confidence: 'medium',
    });
    expect(result.source).toBe('layout (1 source)');
  });

  it('reads the Info dictionary, ignoring timestamps stamped by a re-printing producer', async () => {
    stubRegistries({});
    const trusted = opener({
      pages: [{ items: [{ str: PROSE }] }],
      info: { Title: 'A Study of Sparse Networks', Author: 'Ann Lee and Bo Chen', CreationDate: 'D:20120101' },
    });
    const reprinted = opener({
      pages: [{ items: [{ str: PROSE }] }],
      info: { Title: 'A Study of Sparse Networks', CreationDate: 'D:20240101', Producer: 'Skia/PDF m120' },
    });

    const first = await new PdfImportParser(trusted).parse(PDF_BYTES, 'stem');
    const second = await new PdfImportParser(reprinted).parse(PDF_BYTES, 'stem');

    expect(first).toMatchObject({ title: 'A Study of Sparse Networks', authors: ['Ann Lee', 'Bo Chen'], year: 2012 });
    expect(second.year).toBeUndefined();
  });

  it('uses the file stem with low confidence when nothing identifies the paper', async () => {
    stubRegistries({});

    const result = await new PdfImportParser(opener({ pages: [{ items: [{ str: PROSE }] }] })).parse(
      PDF_BYTES,
      'my_scan-2020',
    );

    expect(result).toMatchObject({ title: 'my scan 2020', citeKey: 'myscan2020', confidence: 'low', authors: [] });
  });

  it('reads the front matter optically when the text layer is sparse and confirms the DOI found there', async () => {
    stubRegistries({ 'api.crossref.org/works/': () => ({ message: crossRefWork }) });
    const ocr: PdfOcrEngine = { recognize: jest.fn(async () => `${TITLE}\nKaiming He, Jian Sun\ndoi:10.1109/cvpr.2016.90`) };

    const result = await new PdfImportParser(opener({ pages: [{ items: [{ str: 'Downloaded stamp' }] }] }), { ocr }).parse(
      PDF_BYTES,
      'scan',
    );

    expect(ocr.recognize).toHaveBeenCalledWith(PDF_BYTES, [1, 2]);
    expect(result).toMatchObject({ title: TITLE, confidence: 'high' });
    expect(result.source).toContain('+ocr');
  });

  it('runs OCR as a last resort when readable text offers neither identifier nor title', async () => {
    stubRegistries({ 'api.crossref.org/works/': () => ({ message: crossRefWork }) });
    const ocr: PdfOcrEngine = { recognize: jest.fn(async () => 'masthead image text doi:10.1109/cvpr.2016.90') };

    const result = await new PdfImportParser(opener({ pages: [{ items: [{ str: PROSE }, { str: PROSE }] }] }), { ocr }).parse(
      PDF_BYTES,
      'scan',
    );

    expect(ocr.recognize).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ title: TITLE, confidence: 'high' });
    expect(result.source).toContain('+ocr');
  });

  it('degrades to no OCR text when the engine fails', async () => {
    stubRegistries({});
    const ocr: PdfOcrEngine = { recognize: jest.fn(async () => Promise.reject(new Error('engine down'))) };

    const result = await new PdfImportParser(opener({ pages: [{ items: [{ str: 'stamp' }] }] }), { ocr }).parse(
      PDF_BYTES,
      'scan',
    );

    expect(result).toMatchObject({ title: 'scan', confidence: 'low' });
  });

  it('rejects bytes without a PDF header', async () => {
    const parser = new PdfImportParser(opener({ pages: [] }));

    await expect(parser.parse(new TextEncoder().encode('not a pdf'), 'x')).rejects.toThrow(
      'File is not a valid PDF (missing %PDF- header).',
    );
  });

  it('rejects a PDF header that is not the first bytes of the file', async () => {
    const parser = new PdfImportParser(opener({ pages: [] }));

    await expect(parser.parse(new TextEncoder().encode('\n%PDF-1.7 body'), 'x')).rejects.toThrow(
      'File is not a valid PDF (missing %PDF- header).',
    );
  });

  it('maps pdf.js open failures to messages a user can act on', async () => {
    const failing = (error: unknown): PdfDocumentOpener => ({ open: async () => Promise.reject(error) });
    const named = (name: string): Error => Object.assign(new Error('boom'), { name });

    await expect(new PdfImportParser(failing(named('PasswordException'))).parse(PDF_BYTES, 'x')).rejects.toThrow(
      'The PDF is password-protected and could not be read.',
    );
    await expect(new PdfImportParser(failing(named('InvalidPDFException'))).parse(PDF_BYTES, 'x')).rejects.toThrow(
      'The PDF is corrupted or incomplete and could not be read.',
    );
    await expect(new PdfImportParser(failing(new Error('Missing xref table'))).parse(PDF_BYTES, 'x')).rejects.toThrow(
      'The PDF is corrupted or incomplete and could not be read.',
    );
    await expect(new PdfImportParser(failing(new Error('other'))).parse(PDF_BYTES, 'x')).rejects.toThrow('other');
  });
});
