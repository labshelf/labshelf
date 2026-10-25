/** The list host builds the citation map on request and imports a missing work by its DOI, answering with the map's messages. */
import * as path from 'node:path';
import type { ImportOutcome } from '@labshelf/core';
import { handleListMessage } from '../../../src/libraryUi/host/listHandlers';
import { showCitationMap } from '../../../src/libraryUi/citationMap/citationMapHandlers';
import type { ListHostContext } from '../../../src/libraryUi/host/hostContext';

const map = { papers: [{ id: 'p1', title: 'P1' }], links: [], missing: [] };

function context(importOutcome: ImportOutcome | Error = { status: 'added', record: { id: 'w1', title: 'Cited work' } as never, needsReview: false, input: '10.1000/x' }) {
  const post = jest.fn(async (_message: unknown) => undefined);
  const notice = jest.fn();
  const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
  const citationMap = {
    buildCitationMap: jest.fn(async () => map),
    importByDoi: jest.fn(async () => { if (importOutcome instanceof Error) { throw importOutcome; } return importOutcome; }),
  };
  const ctx = { deps: { pathOps: path, logger, citationMap }, paths: () => ({ root: '/lib/papers' }), post, notice } as unknown as ListHostContext;
  return { ctx, post, notice, logger, citationMap };
}

describe('citationMap.refresh', () => {
  it('posts the loading state, then the map', async () => {
    const { ctx, post, citationMap } = context();
    await handleListMessage(ctx, { type: 'citationMap.refresh' });
    expect(post.mock.calls.map(([m]) => m)).toEqual([
      { type: 'citationMap.show', state: { status: 'loading' } },
      { type: 'citationMap.show', state: { status: 'ready', map } },
    ]);
    expect(citationMap.buildCitationMap).toHaveBeenCalledTimes(1);
  });

  it('posts why the build failed and logs it', async () => {
    const { ctx, post, logger, citationMap } = context();
    citationMap.buildCitationMap.mockRejectedValueOnce(new Error('offline'));
    await showCitationMap(ctx);
    expect(post).toHaveBeenLastCalledWith({ type: 'citationMap.show', state: { status: 'failed', message: 'offline' } });
    expect(logger.log).toHaveBeenCalledWith('ERROR', 'libraryUi', 'Building the citation map failed', { message: 'offline' });
  });
});

describe('citationMap.import', () => {
  const importMessage = { type: 'citationMap.import', workId: 'W1', doi: '10.1000/x' };

  it('imports by DOI and reports the work imported', async () => {
    const { ctx, post, notice, citationMap } = context();
    await handleListMessage(ctx, importMessage);
    expect(citationMap.importByDoi).toHaveBeenCalledWith('10.1000/x');
    expect(notice).toHaveBeenCalledWith('ok', 'Imported "Cited work"');
    expect(post).toHaveBeenCalledWith({ type: 'citationMap.imported', workId: 'W1' });
  });

  it('counts a DOI already in the library as imported', async () => {
    const { ctx, post, notice } = context({ status: 'duplicate', existingId: 'p9', input: '10.1000/x' });
    await handleListMessage(ctx, importMessage);
    expect(notice).toHaveBeenCalledWith('info', 'This paper is already in your library');
    expect(post).toHaveBeenCalledWith({ type: 'citationMap.imported', workId: 'W1' });
  });

  it('reports a failed import with the DOI and clears the busy button', async () => {
    const { ctx, post, notice, logger } = context({ status: 'failed', error: 'no PDF found', input: '10.1000/x' });
    await handleListMessage(ctx, importMessage);
    expect(notice).toHaveBeenCalledWith('error', 'Could not import 10.1000/x — no PDF found');
    expect(post).toHaveBeenCalledWith({ type: 'citationMap.importFailed', workId: 'W1' });
    expect(post).not.toHaveBeenCalledWith({ type: 'citationMap.imported', workId: 'W1' });
    expect(logger.log).toHaveBeenCalledWith('ERROR', 'libraryUi', 'Importing a missing work failed', { workId: 'W1', doi: '10.1000/x', message: 'no PDF found' });
  });

  it('reports an importer that throws the same way', async () => {
    const { ctx, post, notice } = context(new Error('network down'));
    await handleListMessage(ctx, importMessage);
    expect(notice).toHaveBeenCalledWith('error', 'Could not import 10.1000/x — network down');
    expect(post).toHaveBeenCalledWith({ type: 'citationMap.importFailed', workId: 'W1' });
  });
});
