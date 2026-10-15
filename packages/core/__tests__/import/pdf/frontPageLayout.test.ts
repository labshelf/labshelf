import { titleFromBlocks, type TextBlock } from '@labshelf/core';

// Page 1 of a SIAM 1986 article: the licence stamp is set larger than the title.
const SIAM_PAGE: TextBlock[] = [
  { size: 14, text: 'Downloaded 12/25/12 to 134.76.162.1. Redistribution subject to SIAM license or copyright; see http://www.siam.org/journals/ojsa.php' },
  { size: 9, text: 'SIAM J. COMPUT. © 1986 Society for Industrial and Applied Mathematics Vol. 15, No. 2, May 1986' },
  { size: 12, text: 'EFFICIENT ALGORITHMS FOR GEOMETRIC GRAPH SEARCH PROBLEMS*' },
  { size: 9, text: 'HIROSHI IMAI AND TAKAO ASANO' },
  { size: 8, text: 'Abstract. In this paper, we show that many graph search problems can be solved quite efficiently.' },
  { size: 8, text: 'and then show how those operations can be executed on a geometric intersection graph of segments.' },
];

describe('titleFromBlocks', () => {
  it('does not take an access stamp for the title, however large its font', () => {
    expect(titleFromBlocks(SIAM_PAGE)).toBe('EFFICIENT ALGORITHMS FOR GEOMETRIC GRAPH SEARCH PROBLEMS*');
  });

  it('returns undefined when the stamp is all the page offers', () => {
    expect(titleFromBlocks([SIAM_PAGE[0]!, { size: 8, text: 'body text of the page that goes on' }])).toBeUndefined();
  });
});
