/** Unit tests for reading the abstract printed in front matter. */

import { extractAbstract } from '@labshelf/core';

const ABSTRACT_BODY =
  'Deeper neural networks are more difficult to train. We present a residual ' +
  'learning framework to ease the training of networks that are substantially ' +
  'deeper than those used previously. We explicitly reformulate the layers as ' +
  'learning residual functions with reference to the layer inputs, instead of ' +
  'learning unreferenced functions.';

const FRONT_MATTER = [
  'Deep Residual Learning for Image Recognition',
  'Kaiming He, Xiangyu Zhang, Shaoqing Ren, Jian Sun',
  'Microsoft Research',
  'Abstract',
  ABSTRACT_BODY,
  '1. Introduction',
  'Deep convolutional neural networks have led to a series of breakthroughs.',
].join('\n');

describe('abstractFromText', () => {
  it('reads the abstract from a paper front matter and stops at the next section', () => {
    const abstract = extractAbstract(FRONT_MATTER);

    expect(abstract).toBe(ABSTRACT_BODY);
    expect(abstract).not.toContain('Introduction');
  });

  it('tolerates the delimiters publishers print after the heading', () => {
    expect(extractAbstract(`ABSTRACT—${ABSTRACT_BODY}\nKeywords: residual learning`)).toBe(ABSTRACT_BODY);
    expect(extractAbstract(`Resumo: ${ABSTRACT_BODY}\n1 Introdução\nTexto.`)).toBe(ABSTRACT_BODY);
  });

  it('collapses the line breaks the text layer leaves inside the abstract', () => {
    const wrapped = 'Abstract\n' + ABSTRACT_BODY.replace(/ /g, '\n') + '\nIntroduction';

    expect(extractAbstract(wrapped)).toBe(ABSTRACT_BODY);
  });

  it('rejects a run too short to be an abstract', () => {
    expect(extractAbstract('Abstract. See the abstract online.')).toBeUndefined();
  });

  it('returns undefined when the front matter has no abstract heading', () => {
    expect(extractAbstract('A short note with no abstract heading at all.')).toBeUndefined();
    expect(extractAbstract('')).toBeUndefined();
  });
});
