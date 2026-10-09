/** Unit tests for judging whether extracted PDF text is readable natural language. */

import { isSparseText, looksLikeNaturalText } from '@labshelf/core';

describe('looksLikeNaturalText', () => {
  it('rejects text recovered from fonts with a broken ToUnicode map', () => {
    // Real page-1 output from a PDF whose embedded subset fonts scramble the
    // character map; every "word" is unreadable.
    const scrambled = (
      'WrnE ynEENFCnAMNAyN wUGNVBFN xNETNUNL NzH VLNEF FGwGF BK wy HT ' +
      'ZNCwEGVNAG BO XRBNAPRANNERAP kARINEFRGL BO YwUROBEARw XNETNUNL ' +
      'kARGNz iGwGNFW jt YQwA iyQBBU BO fHxURytNwUGQ twEIwEz kARINEFRGL'
    ).repeat(3);

    expect(looksLikeNaturalText(scrambled)).toBe(false);
  });

  it('accepts ordinary English and Portuguese prose', () => {
    const english =
      'The dominant sequence transduction models are based on complex recurrent ' +
      'or convolutional neural networks in an encoder decoder configuration and ' +
      'we propose a new simple network architecture based on attention mechanisms ' +
      'that dispenses with recurrence and convolutions entirely for these tasks.';
    const portuguese =
      'Este trabalho apresenta uma analise dos dados de expressao genica que foram ' +
      'obtidos para as amostras do estudo com o objetivo de avaliar os efeitos da ' +
      'intervencao e para que os resultados possam ser comparados com os controles.';

    expect(looksLikeNaturalText(english)).toBe(true);
    expect(looksLikeNaturalText(portuguese)).toBe(true);
  });

  it('does not reject documents with too little text to judge', () => {
    expect(looksLikeNaturalText('Xyz Qrs')).toBe(true);
  });
});

describe('isSparseText', () => {
  const STAMP =
    'Downloaded 12/25/12 to 150.135.135.70. Redistribution subject to SIAM license or copyright; see http://www.siam.org/journals/ojsa.php';

  it('treats a stamp repeated on every page as no text at all', () => {
    // Joined, three copies exceed the word floor; no single page does.
    expect(isSparseText([STAMP, STAMP, STAMP])).toBe(true);
    expect(isSparseText([])).toBe(true);
  });

  it('accepts a layer in which any page reads like a page', () => {
    const page = 'We study the behaviour of graph search on geometric inputs. '.repeat(8);
    expect(isSparseText([STAMP, page])).toBe(false);
  });
});
