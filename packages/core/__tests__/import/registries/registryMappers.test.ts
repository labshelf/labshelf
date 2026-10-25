/**
 * Characterization tests for the registry clients: each maps one registry's
 * payload onto a metadata record and returns undefined (or nothing) on failure.
 */

import {
  fetchArxivByIdentifier,
  fetchCrossrefByDoi,
  searchCrossref,
  fetchDataciteByDoi,
  searchDblp,
  searchEuropePmc,
  fetchGoogleBooksByIsbn,
  openAlexSearch,
  openLibraryByIsbn,
  resolvePmidFromPmcid,
  fetchPubmedByPmid,
  fetchSemanticScholarByDoi,
  fetchSemanticScholarByTitle,
  type ILogger,
  type RegistryEnv,
} from '@labshelf/core';

const env: RegistryEnv = {};

function serve(body: string | object, ok = true): jest.Mock {
  const mock = jest.fn(async () => ({
    ok,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }));
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

describe('registry clients', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('transport', () => {
    it('sends the product User-Agent and a JSON Accept header', async () => {
      const mock = serve({ message: {} });

      await fetchCrossrefByDoi(env, '10.1/x');

      const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://api.crossref.org/works/10.1%2Fx');
      expect(init.headers).toEqual({
        Accept: 'application/json',
        'User-Agent': 'LabShelf/0.1 (research paper manager; mailto:contact@labshelf.org)',
      });
    });

    it('uses the injected fetch and the configured contact address, leaving the global fetch alone', async () => {
      const global_ = jest.fn();
      global.fetch = global_ as unknown as typeof fetch;
      const injected = jest.fn(async () => ({ ok: true, text: async () => JSON.stringify({ message: {} }) }));

      await fetchCrossrefByDoi({ fetch: injected as unknown as typeof fetch, contactEmail: 'me@uni.edu' }, '10.1/x');

      expect(global_).not.toHaveBeenCalled();
      const [, init] = injected.mock.calls[0] as unknown as [string, RequestInit];
      expect(init.headers).toMatchObject({ 'User-Agent': 'LabShelf/0.1 (research paper manager; mailto:me@uni.edu)' });
    });

    it('logs a WARN with the url for an error status, a network failure and invalid JSON', async () => {
      const logger = { log: jest.fn(async () => undefined), error: jest.fn() } as unknown as ILogger;
      const logged = { logger };

      serve({}, false);
      await fetchCrossrefByDoi(logged, '10.1/x');
      global.fetch = jest.fn(async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
      await fetchCrossrefByDoi(logged, '10.1/x');
      serve('<html>not json</html>');
      await fetchCrossrefByDoi(logged, '10.1/x');

      const calls = (logger.log as unknown as jest.Mock).mock.calls;
      expect(calls.map((call) => call[2])).toEqual(['Registry lookup failed', 'Registry lookup failed', 'Registry answered with invalid JSON']);
      expect(calls[0][3]).toEqual({ url: 'https://api.crossref.org/works/10.1%2Fx', status: undefined });
      expect(calls[1][3]).toMatchObject({ message: 'offline' });
    });

    it('returns undefined on an error status, a network failure and invalid JSON', async () => {
      serve({}, false);
      expect(await fetchCrossrefByDoi(env, '10.1/x')).toBeUndefined();

      global.fetch = jest.fn(async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
      expect(await fetchCrossrefByDoi(env, '10.1/x')).toBeUndefined();

      serve('<html>not json</html>');
      expect(await fetchCrossrefByDoi(env, '10.1/x')).toBeUndefined();
    });
  });

  describe('CrossRef', () => {
    const work = {
      type: 'journal-article',
      title: ['A Title'],
      author: [{ given: 'Ann', family: 'Lee' }, { name: 'Consortium' }],
      issued: { 'date-parts': [[2020, 5]] },
      'short-container-title': ['J Sci'],
      publisher: ' Pub ',
      volume: '3',
      page: '1-9',
      DOI: '10.1/x',
      ISSN: ['1234-5678'],
      abstract: '<jats:p>Hello   <b>world</b></jats:p>',
    };

    it('maps a work, stripping JATS markup from the abstract', async () => {
      serve({ message: work });

      expect(await fetchCrossrefByDoi(env, '10.1/x')).toEqual({
        title: 'A Title',
        authors: ['Ann Lee', 'Consortium'],
        year: 2020,
        journal: 'J Sci',
        publisher: 'Pub',
        volume: '3',
        issue: undefined,
        pages: '1-9',
        doi: '10.1/x',
        url: undefined,
        issn: '1234-5678',
        language: undefined,
        summary: 'Hello world',
        isComponent: false,
      });
    });

    it('flags component records and maps search items', async () => {
      const mock = serve({ message: { items: [{ ...work, type: 'component' }] } });

      const records = await searchCrossref(env, 'a query', 5);

      expect(records[0]?.isComponent).toBe(true);
      expect((mock.mock.calls[0] as unknown as [string])[0]).toBe(
        'https://api.crossref.org/works?rows=5&query.bibliographic=a%20query',
      );
    });
  });

  it('maps an arXiv entry and rejects an error entry', async () => {
    serve(
      '<feed><entry><id>http://arxiv.org/abs/1706.03762v7</id><published>2017-06-12T17:57:34Z</published>' +
        '<title>Attention\n  Is All You Need</title><summary>An <b>abstract</b>.</summary>' +
        '<author><name>Ashish Vaswani</name></author><author><name>Noam Shazeer</name></author></entry></feed>',
    );

    expect(await fetchArxivByIdentifier(env, '1706.03762')).toEqual({
      title: 'Attention Is All You Need',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      year: 2017,
      journal: 'arXiv preprint',
      doi: undefined,
      url: 'http://arxiv.org/abs/1706.03762v7',
      summary: 'An abstract.',
    });

    serve('<feed><entry><title>Error</title></entry></feed>');
    expect(await fetchArxivByIdentifier(env, '0000.0000')).toBeUndefined();
  });

  it('maps a PubMed summary and resolves a PMC id to a PMID', async () => {
    serve({
      result: {
        '123': {
          title: '<i>Gene</i> study',
          authors: [{ name: 'Lee A' }],
          pubdate: '2019 Mar',
          fulljournalname: 'Nature',
          volume: '7',
          issue: '2',
          pages: '11-9',
          articleids: [{ idtype: 'doi', value: '10.1/g' }],
        },
      },
    });

    expect(await fetchPubmedByPmid(env, '123')).toMatchObject({
      title: 'Gene study',
      authors: ['Lee A'],
      year: 2019,
      journal: 'Nature',
      pages: '11-9',
      doi: '10.1/g',
      url: 'https://doi.org/10.1/g',
    });

    serve({ records: [{ pmid: '123' }] });
    expect(await resolvePmidFromPmcid(env, 'PMC1')).toBe('123');
  });

  it('maps OpenAlex works, dropping the DOI resolver prefix', async () => {
    serve({
      results: [
        {
          display_name: 'A Work',
          doi: 'https://doi.org/10.1/w',
          publication_year: 2021,
          authorships: [{ author: { display_name: 'Ann Lee' } }],
          primary_location: { source: { display_name: 'Venue', issn_l: '1111-2222' }, landing_page_url: 'https://x.org' },
          biblio: { volume: '4', first_page: '10', last_page: '20' },
        },
      ],
    });

    expect((await openAlexSearch(env, 'q'))[0]).toMatchObject({
      title: 'A Work',
      authors: ['Ann Lee'],
      year: 2021,
      journal: 'Venue',
      volume: '4',
      pages: '10-20',
      doi: '10.1/w',
      url: 'https://x.org',
      issn: '1111-2222',
    });
  });

  it('maps a DataCite record', async () => {
    serve({
      data: {
        attributes: {
          doi: '10.5/d',
          titles: [{ title: 'A Dataset' }],
          creators: [{ givenName: 'Ann', familyName: 'Lee' }, { name: 'Lab' }],
          publisher: 'Zenodo',
          publicationYear: 2022,
          descriptions: [{ description: 'About it' }],
        },
      },
    });

    expect(await fetchDataciteByDoi(env, '10.5/d')).toMatchObject({
      title: 'A Dataset',
      authors: ['Ann Lee', 'Lab'],
      year: 2022,
      publisher: 'Zenodo',
      summary: 'About it',
    });

    serve({ data: { attributes: {} } });
    expect(await fetchDataciteByDoi(env, '10.5/none')).toBeUndefined();
  });

  it('maps Semantic Scholar papers by title and by DOI', async () => {
    const paper = {
      title: ' Paper ',
      abstract: 'An abstract',
      year: 2018,
      authors: [{ name: 'Ann Lee' }, { name: ' ' }],
      externalIds: { DOI: '10.1/p' },
      venue: '',
      journal: { name: 'J Venue', volume: '9', pages: '5-8' },
      openAccessPdf: { url: '' },
    };
    serve({ data: [paper] });
    expect(await fetchSemanticScholarByTitle(env, 'Paper')).toEqual({
      title: 'Paper',
      authors: ['Ann Lee'],
      year: 2018,
      journal: 'J Venue',
      volume: '9',
      pages: '5-8',
      doi: '10.1/p',
      url: undefined,
      summary: 'An abstract',
    });

    const mock = serve(paper);
    expect((await fetchSemanticScholarByDoi(env, '10.1/p'))?.title).toBe('Paper');
    expect((mock.mock.calls[0] as unknown as [string])[0]).toContain('/paper/DOI:10.1');
  });

  it('maps Europe PMC results, trimming the trailing full stop of the author sentence', async () => {
    serve({
      resultList: {
        result: [{ id: 'PMC1', source: 'PMC', title: 'T', authorString: 'Doe J, Roe R.', pubYear: '2015', doi: '10.1/e' }],
      },
    });

    expect((await searchEuropePmc(env, 'q', 1))[0]).toMatchObject({
      title: 'T',
      authors: ['Doe J', 'Roe R'],
      year: 2015,
      doi: '10.1/e',
      url: 'https://europepmc.org/article/PMC/PMC1',
    });
  });

  it('maps DBLP hits whether a field arrives as one value or a list', async () => {
    serve({
      result: {
        hits: {
          hit: [
            { info: { title: 'One', authors: { author: { text: 'Ann Lee' } }, year: '2010', venue: 'ICML', ee: ['https://e.org/1'] } },
            { info: { title: 'Two', authors: { author: [{ text: 'A' }, { text: 'B' }] }, venue: ['X', 'Y'], url: 'https://d.org/2' } },
            { info: {} },
          ],
        },
      },
    });

    const records = await searchDblp(env, 'q');

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ title: 'One', authors: ['Ann Lee'], year: 2010, journal: 'ICML', url: 'https://e.org/1' });
    expect(records[1]).toMatchObject({ authors: ['A', 'B'], journal: 'X', url: 'https://d.org/2' });
  });

  it('returns no DBLP records when the query matches nothing', async () => {
    serve({ result: { hits: {} } });

    expect(await searchDblp(env, 'nothing')).toEqual([]);
  });

  it('maps book records from OpenLibrary and Google Books', async () => {
    serve({
      'ISBN:9780262033848': {
        title: 'Introduction to Algorithms',
        subtitle: 'Third Edition',
        authors: [{ name: 'Cormen' }],
        publishers: [{ name: 'MIT Press' }],
        publish_date: 'July 2009',
        number_of_pages: 1312,
        url: 'https://openlibrary.org/b',
      },
    });
    expect(await openLibraryByIsbn(env, '9780262033848')).toEqual({
      title: 'Introduction to Algorithms: Third Edition',
      authors: ['Cormen'],
      year: 2009,
      publisher: 'MIT Press',
      pages: '1312',
      url: 'https://openlibrary.org/b',
    });

    serve({
      items: [
        {
          volumeInfo: {
            title: 'Algorithms',
            authors: ['Cormen'],
            publishedDate: '2009-07-31',
            pageCount: 1312,
            description: '<p>Big   book</p>',
            language: 'en',
          },
        },
      ],
    });
    expect(await fetchGoogleBooksByIsbn(env, '9780262033848')).toMatchObject({
      title: 'Algorithms',
      year: 2009,
      pages: '1312',
      language: 'en',
      summary: 'Big book',
    });
  });
});
