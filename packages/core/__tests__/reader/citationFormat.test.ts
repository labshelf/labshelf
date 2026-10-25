import { normalizeQuote, formatQuoteWithCitation, type CitablePaper } from '../../src/reader/citationFormat';

function paper(overrides: Partial<CitablePaper> = {}): CitablePaper {
  return { citeKey: 'nasser2024', title: 'A Great Paper', authors: ['Luca Nasser'], year: 2024, ...overrides };
}

describe('normalizeQuote', () => {
  it('collapses newlines and repeated whitespace into single spaces', () => {
    expect(normalizeQuote('The   quick\n\tbrown\nfox')).toBe('The quick brown fox');
  });

  it('joins a hyphenated line break, e.g. "inter-\\nnational" -> "international"', () => {
    expect(normalizeQuote('inter-\nnational')).toBe('international');
  });

  it('keeps a real hyphen when the continuation starts with an uppercase letter', () => {
    expect(normalizeQuote('non-\nEuropean countries')).toBe('non- European countries');
  });
});

describe('formatQuoteWithCitation', () => {
  const quote = 'a bold claim';
  const p = paper();

  it('formats the pandoc style', () => {
    expect(formatQuoteWithCitation(quote, p, 12, 'pandoc')).toBe('> a bold claim\n\n[@nasser2024, p. 12]');
  });

  it('formats the latex style', () => {
    expect(formatQuoteWithCitation(quote, p, 12, 'latex')).toBe("``a bold claim'' \\cite[p.~12]{nasser2024}");
  });

  it('formats the author-year style', () => {
    expect(formatQuoteWithCitation(quote, p, 12, 'author-year')).toBe('"a bold claim" (Nasser, 2024, p. 12)');
  });

  it('formats the citekey style: the bare key, deliberately without a page', () => {
    // The minimal style for quick notes; the three richer styles are the ones that carry "p. N".
    expect(formatQuoteWithCitation(quote, p, 12, 'citekey')).toBe('a bold claim @nasser2024');
  });

  it('cleans the quote before formatting (collapses whitespace, de-hyphenates)', () => {
    const messy = 'a bold\nclaim';
    expect(formatQuoteWithCitation(messy, p, 1, 'pandoc')).toBe('> a bold claim\n\n[@nasser2024, p. 1]');
  });
});
