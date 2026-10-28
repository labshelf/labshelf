import type { Annotation } from "@labshelf/core";
import { DEFAULT_READER_PREFS } from "../../../src/reader/protocol/index";
import {
  normalizeReaderPrefs,
  THEME_PRESETS,
  findPagePreset,
  derivePageColors,
  READER_SHELL_BODY,
  normalizeQuote,
  formatQuoteWithCitation,
  type CitablePaper,
  formatAnnotationsMarkdown,
  initialAutohide,
  deriveToolbarVisibility,
  type AutohideInputs,
  type AutohideState,
} from "../../../src/reader/protocol/readerPrefs";
import { PDF_THEMES } from "../../../src/model/index";

describe('normalizeReaderPrefs', () => {
  it('returns the defaults for missing input', () => {
    expect(normalizeReaderPrefs(undefined)).toEqual(DEFAULT_READER_PREFS);
    expect(normalizeReaderPrefs(null)).toEqual(DEFAULT_READER_PREFS);
  });

  it('keeps valid values', () => {
    const prefs = { vimKeys: true, defaultZoom: 'page-fit', toolbarAutoHide: false, restorePosition: false, hoverPreviews: false, hoverDelayMs: 600, citationStyle: 'latex' };
    expect(normalizeReaderPrefs(prefs)).toEqual(prefs);
  });

  it('replaces each invalid value with its default on its own and clamps the hover delay', () => {
    const out = normalizeReaderPrefs({ vimKeys: 'yes', defaultZoom: 'huge', citationStyle: 'apa', hoverDelayMs: 99999, restorePosition: false });
    expect(out.vimKeys).toBe(DEFAULT_READER_PREFS.vimKeys);
    expect(out.defaultZoom).toBe(DEFAULT_READER_PREFS.defaultZoom);
    expect(out.citationStyle).toBe(DEFAULT_READER_PREFS.citationStyle);
    expect(out.hoverDelayMs).toBe(2000);
    expect(out.restorePosition).toBe(false);
    expect(normalizeReaderPrefs({ hoverDelayMs: -5 }).hoverDelayMs).toBe(0);
    expect(normalizeReaderPrefs({ hoverDelayMs: Number.NaN }).hoverDelayMs).toBe(DEFAULT_READER_PREFS.hoverDelayMs);
  });
});

describe('theme presets', () => {
  it('has exactly one page-colour preset per concrete theme', () => {
    const concrete = PDF_THEMES.filter((t) => t !== 'auto').sort();
    expect(Object.keys(THEME_PRESETS).sort()).toEqual(concrete);
  });

  it('maps black-on-white to null so the light theme never recolours figures', () => {
    expect(derivePageColors(THEME_PRESETS.light.bg, THEME_PRESETS.light.text)).toBeNull();
    expect(derivePageColors('#FFFFFF', '#000000')).toBeNull();
    expect(derivePageColors(THEME_PRESETS.dark.bg, THEME_PRESETS.dark.text)).toEqual({
      background: '#1e1e1e', foreground: '#e8e8e8',
    });
  });

  it('falls back to light for an unknown theme', () => {
    expect(findPagePreset('nope')).toEqual(THEME_PRESETS.light);
  });
});

describe('READER_SHELL_BODY', () => {
  it('holds every container the reader UI looks up by id', () => {
    for (const id of ['app', 'sidebar', 'sidebar-resizer', 'pdf-shell', 'toolbar', 'find-bar', 'viewerContainer', 'viewer', 'status-pill', 'loading-msg', 'error-msg', 'selection-toolbar', 'hover-popup', 'cheatsheet']) {
      expect(READER_SHELL_BODY).toContain(`id="${id}"`);
    }
  });

  it('starts with the sidebar and error message hidden and the viewer focusable', () => {
    expect(READER_SHELL_BODY).toContain('<aside id="sidebar" aria-label="Sidebar" hidden>');
    expect(READER_SHELL_BODY).toContain('<div id="error-msg" role="alert" hidden>');
    expect(READER_SHELL_BODY).toContain('<div id="viewerContainer" tabindex="0"><div id="viewer" class="pdfViewer">');
  });
});

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

function markdownPaper(overrides: Partial<CitablePaper> = {}): CitablePaper {
  return { citeKey: 'doe2020', title: 'Great Paper', authors: ['Jane Doe'], year: 2020, ...overrides };
}

function annotation(overrides: Partial<Annotation> & Pick<Annotation, 'type' | 'pageNumber' | 'content' | 'createdAt'>): Annotation {
  return {
    id: 'ann-1',
    paperId: 'paper-1',
    updatedAt: overrides.createdAt,
    ...overrides,
  };
}

describe('formatAnnotationsMarkdown', () => {
  it('renders the title/author header and "_No annotations._" for an empty list', () => {
    const result = formatAnnotationsMarkdown(markdownPaper({ title: 'My Great Paper', citeKey: 'nasser2024' }), []);
    expect(result).toBe('# My Great Paper\n\nDoe, 2020 · `@nasser2024`\n\n_No annotations._\n');
  });

  it('ends with a trailing newline even when there are annotations', () => {
    const result = formatAnnotationsMarkdown(
      markdownPaper(),
      [annotation({ type: 'note', pageNumber: 1, content: 'x', createdAt: '2024-01-01T00:00:00.000Z' })],
    );
    expect(result.endsWith('\n')).toBe(true);
    expect(result.endsWith('\n\n')).toBe(false);
  });

  it('groups annotations under one "## Page N" heading per page, in ascending page order', () => {
    const result = formatAnnotationsMarkdown(markdownPaper(), [
      annotation({ type: 'note', pageNumber: 3, content: 'third', createdAt: '2024-01-03T00:00:00.000Z' }),
      annotation({ type: 'note', pageNumber: 1, content: 'first-a', createdAt: '2024-01-01T00:00:00.000Z' }),
      annotation({ type: 'note', pageNumber: 2, content: 'second', createdAt: '2024-01-02T00:00:00.000Z' }),
      annotation({ type: 'note', pageNumber: 1, content: 'first-b', createdAt: '2024-01-01T01:00:00.000Z' }),
    ]);

    expect(result.match(/## Page 1/g)).toHaveLength(1);
    expect(result.match(/## Page 2/g)).toHaveLength(1);
    expect(result.match(/## Page 3/g)).toHaveLength(1);

    const p1 = result.indexOf('## Page 1');
    const p2 = result.indexOf('## Page 2');
    const p3 = result.indexOf('## Page 3');
    expect(p1).toBeLessThan(p2);
    expect(p2).toBeLessThan(p3);
  });

  it('renders a highlight as a block quote with a colour comment and a pandoc citation', () => {
    const result = formatAnnotationsMarkdown(markdownPaper({ citeKey: 'doe2020' }), [
      annotation({ type: 'highlight', pageNumber: 5, content: 'quoted text', color: 'green', createdAt: '2024-01-01T00:00:00.000Z' }),
    ]);
    expect(result).toContain('> quoted text');
    expect(result).toContain('<!-- highlight: green --> [@doe2020, p. 5]');
  });

  it('defaults the highlight colour comment to "yellow" when no colour is set', () => {
    const result = formatAnnotationsMarkdown(markdownPaper(), [
      annotation({ type: 'highlight', pageNumber: 1, content: 'quoted text', createdAt: '2024-01-01T00:00:00.000Z' }),
    ]);
    expect(result).toContain('<!-- highlight: yellow -->');
  });

  it('renders a note as "**Note:** <content>"', () => {
    const result = formatAnnotationsMarkdown(markdownPaper(), [
      annotation({ type: 'note', pageNumber: 1, content: 'Remember this detail', createdAt: '2024-01-01T00:00:00.000Z' }),
    ]);
    expect(result).toContain('**Note:** Remember this detail');
  });

  it('orders annotations within the same page by createdAt ascending', () => {
    const result = formatAnnotationsMarkdown(markdownPaper(), [
      annotation({ type: 'note', pageNumber: 1, content: 'later note', createdAt: '2024-01-01T10:00:00.000Z' }),
      annotation({ type: 'note', pageNumber: 1, content: 'earlier note', createdAt: '2024-01-01T09:00:00.000Z' }),
    ]);
    expect(result.indexOf('earlier note')).toBeLessThan(result.indexOf('later note'));
  });

  it('produces the exact expected document for a mixed highlight/note, multi-page case', () => {
    const p = markdownPaper({ title: 'Great Paper', citeKey: 'doe2020', authors: ['Jane Doe'], year: 2020 });
    const annotations: Annotation[] = [
      annotation({ type: 'note', pageNumber: 2, content: 'Second page note', createdAt: '2024-01-02T00:00:00.000Z' }),
      annotation({ type: 'highlight', pageNumber: 1, content: 'later highlight text', createdAt: '2024-01-01T10:00:00.000Z' }),
      annotation({ type: 'highlight', pageNumber: 1, content: 'first highlight text', color: 'green', createdAt: '2024-01-01T09:00:00.000Z' }),
    ];

    const expected = [
      '# Great Paper', '', 'Doe, 2020 · `@doe2020`', '',
      '## Page 1', '',
      '> first highlight text', '', '<!-- highlight: green --> [@doe2020, p. 1]', '',
      '> later highlight text', '', '<!-- highlight: yellow --> [@doe2020, p. 1]', '',
      '## Page 2', '',
      '**Note:** Second page note', '',
    ].join('\n');

    expect(formatAnnotationsMarkdown(p, annotations)).toBe(expected);
  });
});

function inputs(overrides: Partial<AutohideInputs> = {}): AutohideInputs {
  return {
    enabled: true,
    scrollTop: 100,
    pointerY: 200,
    focusWithin: false,
    findOpen: false,
    menuOpen: false,
    ...overrides,
  };
}

function scroll(delta: number): { kind: 'scroll'; delta: number } {
  return { kind: 'scroll', delta };
}

describe('deriveToolbarVisibility', () => {
  it('hides only after cumulative downward travel exceeds 24px, across several small scrolls', () => {
    let state: AutohideState = initialAutohide;
    state = deriveToolbarVisibility(state, scroll(10), inputs());
    expect(state).toEqual({ visible: true, travel: 10 });

    state = deriveToolbarVisibility(state, scroll(10), inputs());
    expect(state).toEqual({ visible: true, travel: 20 });

    // Cumulative travel now 30, past the 24px threshold.
    state = deriveToolbarVisibility(state, scroll(10), inputs());
    expect(state).toEqual({ visible: false, travel: 30 });
  });

  it('shows after at least 8px of cumulative upward scroll', () => {
    let state: AutohideState = { visible: false, travel: 30 };
    state = deriveToolbarVisibility(state, scroll(-3), inputs());
    expect(state.visible).toBe(false); // -3px alone is not enough

    state = deriveToolbarVisibility(state, scroll(-3), inputs());
    expect(state.visible).toBe(false); // cumulative -6px, still short

    state = deriveToolbarVisibility(state, scroll(-3), inputs());
    expect(state).toEqual({ visible: true, travel: -9 }); // cumulative -9px crosses -8px
  });

  it('resets the travel counter when the scroll direction changes', () => {
    const state: AutohideState = { visible: true, travel: 15 };
    const next = deriveToolbarVisibility(state, scroll(-3), inputs());
    // Travel is reset to the new delta, not accumulated (15 - 3 would be 12).
    expect(next.travel).toBe(-3);
    expect(next.visible).toBe(true);
  });

  describe('pin conditions force visible and reset travel', () => {
    const dirty: AutohideState = { visible: false, travel: 50 };

    it('enabled = false', () => {
      expect(deriveToolbarVisibility(dirty, scroll(5), inputs({ enabled: false }))).toEqual({ visible: true, travel: 0 });
    });

    it('focusWithin', () => {
      expect(deriveToolbarVisibility(dirty, scroll(5), inputs({ focusWithin: true }))).toEqual({ visible: true, travel: 0 });
    });

    it('findOpen', () => {
      expect(deriveToolbarVisibility(dirty, scroll(5), inputs({ findOpen: true }))).toEqual({ visible: true, travel: 0 });
    });

    it('menuOpen', () => {
      expect(deriveToolbarVisibility(dirty, scroll(5), inputs({ menuOpen: true }))).toEqual({ visible: true, travel: 0 });
    });

    it('scrollTop < 8', () => {
      expect(deriveToolbarVisibility(dirty, scroll(5), inputs({ scrollTop: 5 }))).toEqual({ visible: true, travel: 0 });
    });

    it('pointerY < 48', () => {
      expect(deriveToolbarVisibility(dirty, scroll(5), inputs({ pointerY: 30 }))).toEqual({ visible: true, travel: 0 });
    });

    it('a null pointerY does not pin by itself', () => {
      // pointerY only pins when it is a number below the threshold; null means "pointer elsewhere".
      const result = deriveToolbarVisibility(dirty, scroll(5), inputs({ pointerY: null }));
      expect(result).not.toEqual({ visible: true, travel: 0 });
    });
  });

  it('keeps the current state on an "inputs" event until the next scroll, once a pin is released', () => {
    const stateBeforeRelease: AutohideState = { visible: false, travel: 99 };
    const releasedInputs = inputs({ pointerY: 200 }); // no longer pinned

    const result = deriveToolbarVisibility(stateBeforeRelease, { kind: 'inputs' }, releasedInputs);
    expect(result).toEqual(stateBeforeRelease);

    // A subsequent scroll resumes normal accumulation from that retained state
    // (same downward direction, so the new delta adds onto the stored travel).
    const afterScroll = deriveToolbarVisibility(result, scroll(5), releasedInputs);
    expect(afterScroll.travel).toBe(104);
  });

  it('stays visible through pdf.js\' own scrolling until the reader first moves (engaged: false)', () => {
    // Opening and restoring a position scroll the container programmatically by thousands of pixels.
    let state: AutohideState = initialAutohide;
    state = deriveToolbarVisibility(state, scroll(4000), inputs({ engaged: false }));
    expect(state).toEqual({ visible: true, travel: 0 });

    // Once the reader has scrolled by hand, ordinary auto-hide applies.
    state = deriveToolbarVisibility(state, scroll(30), inputs({ engaged: true }));
    expect(state.visible).toBe(false);
  });

  it('treats an omitted engaged flag as engaged', () => {
    const state = deriveToolbarVisibility(initialAutohide, scroll(30), inputs());
    expect(state.visible).toBe(false);
  });
});
