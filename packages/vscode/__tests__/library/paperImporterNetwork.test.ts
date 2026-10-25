/** The glue around the core network import: the environment the extension hands it and what it does with the outcome. */
import type { ImportOutcome, NetworkImportEnv } from '@labshelf/core';

import { makeGlue, pdfBytes, PAPERS_ROOT } from './paperServiceHarness';

const importNetworkInput = jest.fn<Promise<ImportOutcome>, [NetworkImportEnv, string, string]>();
jest.mock('@labshelf/core', () => ({
  ...jest.requireActual('@labshelf/core'),
  importNetworkInput: (...args: [NetworkImportEnv, string, string]) => importNetworkInput(...args),
}));

beforeEach(() => importNetworkInput.mockReset());

describe('PaperImporter.importFromNetwork', () => {
  it('imports into papers/ by default with the extension network, the index and the library root', async () => {
    const g = makeGlue();
    await g.seed('have-it', { doi: '10.1000/Known' });
    importNetworkInput.mockResolvedValue({ status: 'duplicate', existingId: 'have-it', input: '10.1000/known' });

    await g.importer.importFromNetwork('10.1000/known');

    const [env, input, targetDir] = importNetworkInput.mock.calls[0]!;
    expect([input, targetDir]).toEqual(['10.1000/known', PAPERS_ROOT]);
    expect(env).toMatchObject({ ctx: g.ctx, tmpDir: '/lib/tmp', download: { fetch: expect.any(Function), headers: { 'User-Agent': 'LabShelf-VSCode/test' } } });
    expect(env.importDeps().findByDoi('10.1000/known')).toBe('have-it');
    expect([...env.importDeps().takenIds()]).toEqual(['have-it']);
    expect(env.records().map((paper) => paper.id)).toEqual(['have-it']);
  });

  it('indexes the added paper and announces it, like a local import', async () => {
    const g = makeGlue();
    const folder = `${PAPERS_ROOT}/ML/lee2020study`;
    // The real importNetworkInput writes the paper's files before returning "added"; the mock does the same so the
    // reindex that follows (a real disk rescan) finds it.
    importNetworkInput.mockImplementation(async () => {
      await g.fs.writeText(`${folder}/metadata.yaml`, 'title: "Lee 2020 Study"\n');
      await g.fs.writeFile(`${folder}/paper.pdf`, pdfBytes());
      return { status: 'added', record: { id: 'lee2020study', title: 'Lee 2020 Study', path: folder, citeKey: 'lee2020study', status: 'unread', hasPdf: true }, needsReview: false, input: '10.1000/x' };
    });

    const outcome = await g.importer.importFromNetwork('10.1000/x', `${PAPERS_ROOT}/ML`);

    expect(importNetworkInput.mock.calls[0]![2]).toBe(`${PAPERS_ROOT}/ML`);
    expect(outcome.status).toBe('added');
    expect(g.rows.map((row) => row.id)).toEqual(['lee2020study']);
    expect(g.emitted).toEqual([['paper:added', expect.objectContaining({ id: 'lee2020study' })]]);
  });

  it('indexes nothing when the import fails or finds a duplicate', async () => {
    const g = makeGlue();
    importNetworkInput.mockResolvedValue({ status: 'failed', error: 'Could not find DOI 10.1000/x', input: '10.1000/x' });

    await g.importer.importFromNetwork('10.1000/x');

    expect(g.reindexCalls()).toBe(0);
    expect(g.emitted).toEqual([]);
  });
});
