/** Unit tests for building the citation key of a paper. */

import { buildCiteKey } from '@labshelf/core';

describe('buildCiteKey', () => {
  it('prefers the identifier, then the title, and only then the file stem', () => {
    expect(buildCiteKey('artigo-1', 'Attention Is All You Need', 2017, '10.1000/xyz')).toBe('101000xyz2017');
    expect(buildCiteKey('artigo-1', 'Attention Is All You Need', 2017)).toBe('attentionisallyouneed2017');
    expect(buildCiteKey('artigo-1', '', undefined)).toBe('artigo1');
  });

  it('folds accents instead of dropping the letter, and caps a long title', () => {
    expect(buildCiteKey('x', 'Análise de Proteínas')).toBe('analisedeproteinas');
    expect(buildCiteKey('x', 'word '.repeat(40)).length).toBe(48);
  });
});
