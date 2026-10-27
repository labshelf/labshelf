import * as vscode from 'vscode';
import { makeGlue, pdfBytes, PAPERS_ROOT } from './paperServiceHarness';

describe('PaperImporter', () => {
  it('imports a PDF, then indexes it and announces it', async () => {
    const g = makeGlue();
    await g.fs.writeFile('/docs/a.pdf', pdfBytes());

    const outcomes = await g.importer.importPaths(['/docs/a.pdf']);

    expect(outcomes).toEqual([expect.objectContaining({ status: 'added', record: expect.objectContaining({ id: 'testpaper2024' }) })]);
    expect(await g.fs.exists(`${PAPERS_ROOT}/testpaper2024/paper.pdf`)).toBe(true);
    expect(g.rows.map((row) => row.id)).toEqual(['testpaper2024']);
    expect(g.emitted).toEqual([['paper:added', expect.objectContaining({ id: 'testpaper2024', hasPdf: true })]]);
  });

  it('indexes each paper as soon as its file is done, before the next file starts', async () => {
    const g = makeGlue();
    await g.fs.writeFile('/docs/a.pdf', pdfBytes('a'));
    await g.fs.writeFile('/docs/b.pdf', pdfBytes('b'));
    const indexedWhenStarting: number[] = [];

    await g.importer.importPaths(['/docs/a.pdf', '/docs/b.pdf'], undefined, () => indexedWhenStarting.push(g.rows.length));

    expect(indexedWhenStarting).toEqual([0, 1]);
    expect(g.emitted.map(([name]) => name)).toEqual(['paper:added', 'paper:added']);
  });

  it('does not import a PDF whose DOI is already in the library', async () => {
    const g = makeGlue();
    await g.seed('vaswani2017', { doi: '10.5555/Attention' });
    await g.fs.writeFile('/docs/again.pdf', pdfBytes());
    g.parse.mockResolvedValue({ title: 'Attention', citeKey: 'vaswani2017b', doi: '10.5555/attention' });

    const outcomes = await g.importer.importPaths(['/docs/again.pdf']);

    expect(outcomes).toEqual([{ status: 'duplicate', existingId: 'vaswani2017', input: '/docs/again.pdf' }]);
    expect(g.rows.map((row) => row.id)).toEqual(['vaswani2017']);
    expect(g.emitted).toEqual([]);
  });

  it('avoids ids the index already holds, ignoring case', async () => {
    const g = makeGlue();
    await g.seed('TestPaper2024');
    await g.fs.writeFile('/docs/a.pdf', pdfBytes());

    const [outcome] = await g.importer.importPaths(['/docs/a.pdf'], `${PAPERS_ROOT}/ML`);

    expect(outcome).toMatchObject({ status: 'added', record: { id: 'testpaper2024a', path: `${PAPERS_ROOT}/ML/testpaper2024a` } });
  });

  it('indexes nothing for a failed import', async () => {
    const g = makeGlue();
    await g.fs.writeText('/docs/readme.pdf', 'not a pdf');

    const outcomes = await g.importer.importPaths(['/docs/readme.pdf']);

    expect(outcomes).toEqual([{ status: 'failed', error: 'Not a PDF file', input: '/docs/readme.pdf' }]);
    expect(g.reindexCalls()).toBe(0);
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });
});

describe('PaperTextLayers.makeSearchable', () => {
  it('replaces paper.pdf through the file-system port and records the OCR verdict', async () => {
    const g = makeGlue();
    await g.seed('scan1986');
    const bytes = new Uint8Array([9, 9]);
    const build = jest.fn(async () => ({ status: 'added', bytes, pagesAdded: 17, pagesFailed: 1 }));

    const result = await g.textLayers({ build }).makeSearchable('scan1986');

    expect(result).toMatchObject({ status: 'added', pagesAdded: 17 });
    expect([...(await g.fs.readFile(`${PAPERS_ROOT}/scan1986/paper.pdf`))]).toEqual([9, 9]);
    expect(await g.fs.readText(`${PAPERS_ROOT}/scan1986/metadata.yaml`)).toMatch(/state: ocr/);
    expect(g.rows[0]!.textLayer).toMatchObject({ state: 'ocr', ocrPages: 17, failedPages: 1 });
    expect(g.emitted).toEqual([['paper:updated', expect.objectContaining({ textLayer: expect.objectContaining({ state: 'ocr' }) })]]);
  });

  it('writes to where the paper is now when it moved during OCR', async () => {
    const g = makeGlue();
    await g.seed('scan1986');
    await g.fs.mkdir(`${PAPERS_ROOT}/Moved`);
    const build = jest.fn(async () => {
      await g.service.movePapers(['scan1986'], `${PAPERS_ROOT}/Moved`);
      return { status: 'added', bytes: new Uint8Array([1]), pagesAdded: 2, pagesFailed: 0 };
    });

    await g.textLayers({ build }).makeSearchable('scan1986');

    expect([...(await g.fs.readFile(`${PAPERS_ROOT}/Moved/scan1986/paper.pdf`))]).toEqual([1]);
    expect(g.rows[0]).toMatchObject({ path: `${PAPERS_ROOT}/Moved/scan1986`, textLayer: { state: 'ocr' } });
  });

  it('records the verdict of an outcome that leaves the file alone, and skips an unchanged one', async () => {
    const g = makeGlue();
    await g.seed('p1');
    const build = jest.fn(async () => ({ status: 'not-needed', layer: 'native' }));
    const layers = g.textLayers({ build });

    expect(await layers.makeSearchable('p1')).toEqual({ status: 'not-needed', layer: 'native' });
    expect(g.rows[0]!.textLayer).toMatchObject({ state: 'native' });
    expect(g.reindexCalls()).toBe(1);
    await layers.makeSearchable('p1');
    expect(g.reindexCalls()).toBe(1);
  });

  it('skips a paper without a PDF and records nothing', async () => {
    (vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error('EntryNotFound'));
    const g = makeGlue();
    await g.seed('p1');
    const build = jest.fn();

    expect(await g.textLayers({ build }).makeSearchable('p1')).toEqual({ status: 'skipped', reason: 'it has no PDF' });
    expect(build).not.toHaveBeenCalled();
    expect(g.reindexCalls()).toBe(0);
  });

  it('records a builder crash as failed and reports a missing builder or paper', async () => {
    const g = makeGlue();
    await g.seed('p1');
    expect(await g.textLayers().makeSearchable('p1')).toMatchObject({ status: 'unavailable' });
    const layers = g.textLayers({ build: jest.fn(async () => { throw new Error('boom'); }) });
    expect(await layers.makeSearchable('ghost')).toEqual({ status: 'unavailable', reason: 'paper not found' });
    expect(await layers.makeSearchable('p1')).toEqual({ status: 'unavailable', reason: 'boom' });
    expect(g.rows[0]!.textLayer).toMatchObject({ state: 'failed', reason: 'boom' });
  });
});

describe('PaperTextLayers.checkTextLayer', () => {
  it('records the detection without reading any page optically', async () => {
    const g = makeGlue();
    await g.seed('p1');
    const builder = { build: jest.fn(), detect: jest.fn(async () => ({ status: 'missing', textlessPages: 3, totalPages: 3 })) };

    expect((await g.textLayers(builder).checkTextLayer('p1'))?.textLayer).toMatchObject({ state: 'missing' });
    expect(builder.build).not.toHaveBeenCalled();
  });

  it('returns undefined for an unknown paper or without a builder', async () => {
    const g = makeGlue();
    await g.seed('p1');
    expect(await g.textLayers().checkTextLayer('p1')).toBeUndefined();
    expect(await g.textLayers({ detect: jest.fn() }).checkTextLayer('ghost')).toBeUndefined();
  });
});
