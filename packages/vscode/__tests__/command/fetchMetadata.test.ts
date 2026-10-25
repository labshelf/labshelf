import { resolveFirstIdentifier, searchOnlineCandidates, type ILogger } from '@labshelf/core';

import { findMetadataForQuery } from '../../src/command/fetchMetadata';

jest.mock('@labshelf/core', () => ({
  ...jest.requireActual('@labshelf/core'),
  resolveFirstIdentifier: jest.fn(),
  searchOnlineCandidates: jest.fn(),
}));

const resolveFirst = resolveFirstIdentifier as jest.Mock;
const search = searchOnlineCandidates as jest.Mock;

const logger = { log: jest.fn(), error: jest.fn() } as unknown as ILogger;

beforeEach(() => {
  jest.clearAllMocks();
  search.mockResolvedValue([]);
});

describe('findMetadataForQuery', () => {
  it('resolves a pasted PubMed link as a PMID', async () => {
    resolveFirst.mockResolvedValue({ metadata: { title: 'A paper' }, identifier: { type: 'pmid', value: '12345678' } });

    const found = await findMetadataForQuery('https://pubmed.ncbi.nlm.nih.gov/12345678/', logger);

    expect(resolveFirst).toHaveBeenCalledWith([{ type: 'pmid', value: '12345678' }], { logger });
    expect(found).toEqual([{ title: 'A paper' }]);
    expect(search).not.toHaveBeenCalled();
  });

  it('resolves a bare DOI typed with trailing punctuation', async () => {
    resolveFirst.mockResolvedValue(undefined);

    await findMetadataForQuery('10.1038/nature12373,', logger);

    expect(resolveFirst).toHaveBeenCalledWith([{ type: 'doi', value: '10.1038/nature12373' }], { logger });
  });

  it('searches by title when the input holds no identifier', async () => {
    search.mockResolvedValue([{ title: 'Attention Is All You Need' }]);

    const found = await findMetadataForQuery('Attention Is All You Need', logger);

    expect(resolveFirst).not.toHaveBeenCalled();
    expect(found).toEqual([{ title: 'Attention Is All You Need' }]);
  });
});
