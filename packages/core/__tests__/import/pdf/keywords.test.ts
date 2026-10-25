/** Unit tests for reading the keyword list printed below the abstract. */

import { keywordsFromText } from '@labshelf/core';

describe('keywordsFromText', () => {
  it('splits a keyword line on commas, semicolons and middle dots', () => {
    const text =
      'Keywords: machine learning, neural networks; attention mechanisms · transformers\n' +
      '1 Introduction\nDeep convolutional neural networks have led to breakthroughs.';

    expect(keywordsFromText(text)).toEqual([
      'machine learning',
      'neural networks',
      'attention mechanisms',
      'transformers',
    ]);
  });

  it('reads a Portuguese keyword line', () => {
    const text =
      'Palavras-chave: genômica, dobramento de proteínas, simulação molecular\n\n' +
      '1 Introdução\nEste trabalho apresenta uma análise dos dados.';

    expect(keywordsFromText(text)).toEqual([
      'genômica',
      'dobramento de proteínas',
      'simulação molecular',
    ]);
  });

  it('reads the labels used by IEEE and Springer', () => {
    expect(keywordsFromText('Index Terms—image segmentation, deep learning.')).toEqual([
      'image segmentation',
      'deep learning',
    ]);
    expect(keywordsFromText('Key words: proteomics; mass spectrometry')).toEqual([
      'proteomics',
      'mass spectrometry',
    ]);
  });

  it('dedupes case-insensitively and caps the list at fifteen entries', () => {
    expect(keywordsFromText('Keywords: Genomics, genomics, GENOMICS')).toEqual(['Genomics']);

    const many = Array.from({ length: 20 }, (_, index) => `topic ${index}`).join(', ');
    expect(keywordsFromText(`Keywords: ${many}`)).toHaveLength(15);
  });

  it('drops entries too short or too long to be keywords', () => {
    const tooLong = 'x'.repeat(61);

    expect(keywordsFromText(`Keywords: a, ok, ${tooLong}`)).toEqual(['ok']);
  });

  it('returns an empty array when there is no keyword line', () => {
    expect(keywordsFromText('An abstract with no keyword line below it.')).toEqual([]);
    expect(keywordsFromText('')).toEqual([]);
  });
});
