/** The citation map ports build over the library's OpenAlex cache and import by DOI, queueing the OCR check of an added paper. */
import { buildCitationMap } from '@labshelf/core';
import { createCitationMapPorts } from '../../../src/libraryUi/citationMap/createCitationMapPorts';
import { addTextLayersOfAdded } from '../../../src/command/index';
import type { ActiveServices } from '../../../src/command/index';

jest.mock('@labshelf/core', () => ({ ...jest.requireActual('@labshelf/core'), buildCitationMap: jest.fn() }));
jest.mock('../../../src/command/index', () => ({ addTextLayersOfAdded: jest.fn() }));

function services(): ActiveServices {
  return {
    logger: { log: jest.fn(), error: jest.fn() },
    paperService: { listPapers: jest.fn(async () => [{ id: 'a', title: 'A', doi: '10.1/a' }, { id: 'b', title: 'B' }]) },
    importer: { importFromNetwork: jest.fn(async () => ({ status: 'added' })) },
    fileSystem: { kind: 'fs' }, citationCacheDir: '/lib/.research/openalex',
  } as unknown as ActiveServices;
}

describe('createCitationMapPorts', () => {
  it('builds over the library papers and cache, naming the papers the map mentions', async () => {
    const s = services();
    (buildCitationMap as jest.Mock).mockResolvedValue({ links: [], missing: [{ citedBy: ['a'] }], unresolved: [] });
    const view = await createCitationMapPorts(s).buildCitationMap();
    expect(buildCitationMap).toHaveBeenCalledWith(
      expect.objectContaining({ cacheDir: '/lib/.research/openalex', fs: s.fileSystem, logger: s.logger }),
      await s.paperService.listPapers(),
    );
    expect(view.papers).toEqual([{ id: 'a', title: 'A' }]);
  });

  it('imports by DOI and queues the text layer of what was added', async () => {
    const s = services();
    const outcome = await createCitationMapPorts(s).importByDoi('10.1/x');
    expect(s.importer.importFromNetwork).toHaveBeenCalledWith('10.1/x');
    expect(addTextLayersOfAdded).toHaveBeenCalledWith(s, [outcome]);
  });
});
