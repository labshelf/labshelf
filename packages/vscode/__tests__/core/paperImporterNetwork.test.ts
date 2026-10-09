/** The glue around the core network import: the environment the extension hands it and what it does with the outcome. */
import type { ImportOutcome, NetworkImportEnv, PaperRecord } from '@labshelf/core';

import { makeGlue, PAPERS_ROOT } from './paperServiceHarness';

const importNetworkInput = jest.fn<Promise<ImportOutcome>, [NetworkImportEnv, string, string]>();
jest.mock('@labshelf/core', () => ({
  ...jest.requireActual('@labshelf/core'),
  importNetworkInput: (...args: [NetworkImportEnv, string, string]) => importNetworkInput(...args),
}));

const record = (id: string): PaperRecord => ({ id, title: id, path: `${PAPERS_ROOT}/${id}`, citeKey: id, status: 'unread', hasPdf: true });

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
    importNetworkInput.mockResolvedValue({ status: 'added', record: record('lee2020study'), needsReview: false, input: '10.1000/x' });

    const outcome = await g.importer.importFromNetwork('10.1000/x', `${PAPERS_ROOT}/ML`);

    expect(importNetworkInput.mock.calls[0]![2]).toBe(`${PAPERS_ROOT}/ML`);
    expect(outcome.status).toBe('added');
    expect(g.indexWrites).toEqual(['upsert:lee2020study']);
    expect(g.emitted).toEqual([['paper:added', expect.objectContaining({ id: 'lee2020study' })]]);
  });

  it('indexes nothing when the import fails or finds a duplicate', async () => {
    const g = makeGlue();
    importNetworkInput.mockResolvedValue({ status: 'failed', error: 'Could not find DOI 10.1000/x', input: '10.1000/x' });

    await g.importer.importFromNetwork('10.1000/x');

    expect(g.indexWrites).toEqual([]);
    expect(g.emitted).toEqual([]);
  });
});
