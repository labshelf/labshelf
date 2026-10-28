import { isSafeExternalUrl, isWebviewMessage } from "../../../src/reader/protocol/index";

describe('isWebviewMessage', () => {
  describe('accepts a valid sample of every WebviewToHost command', () => {
    it('ready-for-init', () => {
      expect(isWebviewMessage({ command: 'ready-for-init' })).toBe(true);
    });

    it('ready', () => {
      expect(isWebviewMessage({ command: 'ready', totalPages: 12 })).toBe(true);
    });

    it('perf', () => {
      expect(
        isWebviewMessage({
          command: 'perf',
          timeline: { firstPaint: 120 },
          pageNumber: 1,
          theme: 'dark',
          dpr: 2,
          canvas: 'webgl',
        }),
      ).toBe(true);
    });

    it('selectTheme', () => {
      expect(isWebviewMessage({ command: 'selectTheme', theme: 'sepia' })).toBe(true);
    });

    it('createAnnotation', () => {
      expect(
        isWebviewMessage({ command: 'createAnnotation', type: 'highlight', pageNumber: 2, content: 'quoted text' }),
      ).toBe(true);
      expect(
        isWebviewMessage({ command: 'createAnnotation', type: 'note', pageNumber: 2, content: 'a note' }),
      ).toBe(true);
    });

    it('deleteAnnotation', () => {
      expect(isWebviewMessage({ command: 'deleteAnnotation', id: 'ann-1' })).toBe(true);
    });

    it('updateAnnotation', () => {
      expect(isWebviewMessage({ command: 'updateAnnotation', id: 'ann-1', content: 'updated' })).toBe(true);
    });

    it('saveReadingState', () => {
      expect(
        isWebviewMessage({
          command: 'saveReadingState',
          state: { page: 1, scaleValue: '1', updatedAt: '2024-01-01T00:00:00.000Z' },
        }),
      ).toBe(true);
    });

    it('copyWithCitation', () => {
      expect(isWebviewMessage({ command: 'copyWithCitation', text: 'quote', pageNumber: 5 })).toBe(true);
    });

    it('copyText', () => {
      expect(isWebviewMessage({ command: 'copyText', text: 'hello' })).toBe(true);
    });

    it('exportAnnotations', () => {
      expect(isWebviewMessage({ command: 'exportAnnotations', target: 'clipboard' })).toBe(true);
      expect(isWebviewMessage({ command: 'exportAnnotations', target: 'file' })).toBe(true);
    });

    it('openExternalLink', () => {
      expect(isWebviewMessage({ command: 'openExternalLink', url: 'https://example.com' })).toBe(true);
    });
  });

  describe('rejects malformed input', () => {
    it('rejects non-object values', () => {
      expect(isWebviewMessage(null)).toBe(false);
      expect(isWebviewMessage(undefined)).toBe(false);
      expect(isWebviewMessage('ready-for-init')).toBe(false);
      expect(isWebviewMessage(42)).toBe(false);
      expect(isWebviewMessage(['ready-for-init'])).toBe(false);
    });

    it('rejects an unknown command', () => {
      expect(isWebviewMessage({ command: 'doSomethingUnknown' })).toBe(false);
    });

    it('rejects "ready" without a numeric totalPages', () => {
      expect(isWebviewMessage({ command: 'ready' })).toBe(false);
      expect(isWebviewMessage({ command: 'ready', totalPages: '12' })).toBe(false);
    });

    it('rejects "perf" with a non-object timeline', () => {
      expect(isWebviewMessage({ command: 'perf', timeline: 'nope', pageNumber: 1, theme: 'dark', dpr: 1, canvas: null })).toBe(false);
    });

    it('rejects "selectTheme" without a theme string', () => {
      expect(isWebviewMessage({ command: 'selectTheme' })).toBe(false);
      expect(isWebviewMessage({ command: 'selectTheme', theme: 5 })).toBe(false);
    });

    it('rejects "createAnnotation" with type "tag"', () => {
      expect(isWebviewMessage({ command: 'createAnnotation', type: 'tag', pageNumber: 1, content: 'x' })).toBe(false);
    });

    it('rejects "createAnnotation" with missing content', () => {
      expect(isWebviewMessage({ command: 'createAnnotation', type: 'highlight', pageNumber: 1 })).toBe(false);
    });

    it('rejects "deleteAnnotation" with an empty id', () => {
      expect(isWebviewMessage({ command: 'deleteAnnotation', id: '' })).toBe(false);
    });

    it('rejects "updateAnnotation" with empty content', () => {
      expect(isWebviewMessage({ command: 'updateAnnotation', id: 'ann-1', content: '' })).toBe(false);
    });

    it('rejects "saveReadingState" without a state object', () => {
      expect(isWebviewMessage({ command: 'saveReadingState' })).toBe(false);
    });

    it('rejects "copyWithCitation" with a missing pageNumber', () => {
      expect(isWebviewMessage({ command: 'copyWithCitation', text: 'quote' })).toBe(false);
    });

    it('rejects "copyText" with a missing text', () => {
      expect(isWebviewMessage({ command: 'copyText' })).toBe(false);
    });

    it('rejects "exportAnnotations" with target "email"', () => {
      expect(isWebviewMessage({ command: 'exportAnnotations', target: 'email' })).toBe(false);
    });

    it('rejects "openExternalLink" with a missing url', () => {
      expect(isWebviewMessage({ command: 'openExternalLink' })).toBe(false);
    });

    it('rejects NaN numeric fields', () => {
      expect(isWebviewMessage({ command: 'ready', totalPages: NaN })).toBe(false);
      expect(isWebviewMessage({ command: 'copyWithCitation', text: 'x', pageNumber: NaN })).toBe(false);
    });
  });
});

describe('isWebviewMessage preview requests', () => {
  it('accepts a showSource point on a page', () => {
    expect(isWebviewMessage({ command: 'showSource', point: { page: 2, x: 72.5, y: 300 } })).toBe(true);
  });

  it('rejects a showSource point without a positive integer page or finite coordinates', () => {
    expect(isWebviewMessage({ command: 'showSource' })).toBe(false);
    expect(isWebviewMessage({ command: 'showSource', point: { page: 0, x: 1, y: 1 } })).toBe(false);
    expect(isWebviewMessage({ command: 'showSource', point: { page: 1.5, x: 1, y: 1 } })).toBe(false);
    expect(isWebviewMessage({ command: 'showSource', point: { page: 1, x: Number.NaN, y: 1 } })).toBe(false);
    expect(isWebviewMessage({ command: 'showSource', point: { page: 1, x: 1 } })).toBe(false);
  });

  const area = { page: 1, left: 10, top: 20, right: 30, bottom: 40 };

  it('accepts a citation lookup for a link with or without a destination name, and for text', () => {
    expect(isWebviewMessage({ command: 'lookupCitation', request: 1, query: { area, link: true, dest: 'cite.smith2020' } })).toBe(true);
    expect(isWebviewMessage({ command: 'lookupCitation', request: 2, query: { area, link: true } })).toBe(true);
    expect(isWebviewMessage({ command: 'lookupCitation', request: 3, query: { area, link: false } })).toBe(true);
  });

  it('rejects a citation lookup without a request number, a whole area or a string destination', () => {
    expect(isWebviewMessage({ command: 'lookupCitation', query: { area, link: true } })).toBe(false);
    expect(isWebviewMessage({ command: 'lookupCitation', request: 1, query: { area: { ...area, page: 0 }, link: true } })).toBe(false);
    expect(isWebviewMessage({ command: 'lookupCitation', request: 1, query: { area: { page: 1, left: 1, top: 1 }, link: true } })).toBe(false);
    expect(isWebviewMessage({ command: 'lookupCitation', request: 1, query: { area, link: 'yes' } })).toBe(false);
    expect(isWebviewMessage({ command: 'lookupCitation', request: 1, query: { area, link: true, dest: ['x'] } })).toBe(false);
  });

  it('accepts openCitedPaper only with a paper id', () => {
    expect(isWebviewMessage({ command: 'openCitedPaper', paperId: 'smith-2020' })).toBe(true);
    expect(isWebviewMessage({ command: 'openCitedPaper', paperId: '' })).toBe(false);
    expect(isWebviewMessage({ command: 'openCitedPaper' })).toBe(false);
  });
});

describe('isSafeExternalUrl', () => {
  it('accepts http, https and mailto', () => {
    expect(isSafeExternalUrl('http://example.com')).toBe(true);
    expect(isSafeExternalUrl('https://example.com/path?x=1')).toBe(true);
    expect(isSafeExternalUrl('mailto:test@example.com')).toBe(true);
  });

  it('rejects file:, command:, vscode:, javascript: and data: schemes', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('command:workbench.action.something')).toBe(false);
    expect(isSafeExternalUrl('vscode://some/path')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/plain;base64,SGVsbG8=')).toBe(false);
  });

  it('rejects relative and garbage input', () => {
    expect(isSafeExternalUrl('/local/path')).toBe(false);
    expect(isSafeExternalUrl('relative/path')).toBe(false);
    expect(isSafeExternalUrl('not a url at all!!!')).toBe(false);
  });
});

describe('writing actions and build roots', () => {
  it('accepts recompile, revealCursor, openProblem and openRawLog', () => {
    expect(isWebviewMessage({ command: 'recompile' })).toBe(true);
    expect(isWebviewMessage({ command: 'revealCursor' })).toBe(true);
    expect(isWebviewMessage({ command: 'openProblem', root: 'main.typ', index: 0 })).toBe(true);
    expect(isWebviewMessage({ command: 'openProblem', root: 'main.typ', index: 12 })).toBe(true);
    expect(isWebviewMessage({ command: 'openRawLog', root: 'main.typ' })).toBe(true);
  });

  it.each([
    [{ command: 'openProblem', index: 1 }],
    [{ command: 'openProblem', root: '', index: 1 }],
    [{ command: 'openProblem', root: 3, index: 1 }],
    [{ command: 'openProblem', root: 'main.typ' }],
    [{ command: 'openProblem', root: 'main.typ', index: -1 }],
    [{ command: 'openProblem', root: 'main.typ', index: 1.5 }],
    [{ command: 'openProblem', root: 'main.typ', index: '1' }],
    [{ command: 'openRawLog' }],
    [{ command: 'openRawLog', root: '' }],
    [{ command: 'openRawLog', root: 7 }],
  ])('rejects malformed %j', (message) => {
    expect(isWebviewMessage(message)).toBe(false);
  });
});

describe("isWebviewMessage citeInProject", () => {
  it("accepts a paper id alone", () => {
    expect(isWebviewMessage({ command: "citeInProject", paperId: "p1" })).toBe(true);
  });

  it("accepts a page and a quote", () => {
    expect(isWebviewMessage({ command: "citeInProject", paperId: "p1", page: 12, quote: "A quoted passage." })).toBe(true);
    expect(isWebviewMessage({ command: "citeInProject", paperId: "p1", quote: "x".repeat(2000) })).toBe(true);
  });

  it.each([undefined, 7, null, {}])("rejects the paper id %p", (paperId) => {
    expect(isWebviewMessage({ command: "citeInProject", paperId })).toBe(false);
  });

  it("rejects an empty paper id", () => {
    expect(isWebviewMessage({ command: "citeInProject", paperId: "" })).toBe(false);
  });

  it.each([0, -1, 1.5, NaN, Infinity, "3"])("rejects the page %p", (page) => {
    expect(isWebviewMessage({ command: "citeInProject", paperId: "p1", page })).toBe(false);
  });

  it("rejects a quote over 2,000 characters or that is not text", () => {
    expect(isWebviewMessage({ command: "citeInProject", paperId: "p1", quote: "x".repeat(2001) })).toBe(false);
    expect(isWebviewMessage({ command: "citeInProject", paperId: "p1", quote: 5 })).toBe(false);
  });
});
