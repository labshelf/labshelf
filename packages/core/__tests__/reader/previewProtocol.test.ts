// Tests validation of the preview messages a webview sends, and the protocol version.
import { isWebviewMessage, PROTOCOL_VERSION } from '../../src/reader/protocol/index';

const ok = (m: unknown) => expect(isWebviewMessage(m)).toBe(true);
const bad = (m: unknown) => expect(isWebviewMessage(m)).toBe(false);

describe('preview webview messages', () => {
  it('is protocol version 6', () => {
    expect(PROTOCOL_VERSION).toBe(6);
  });

  it('runCommand accepts the three command ids only', () => {
    for (const id of ['compareVersions', 'markVersion', 'checkBeforeSubmitting']) { ok({ command: 'runCommand', id }); }
    bad({ command: 'runCommand', id: 'format' });
    bad({ command: 'runCommand' });
    bad({ command: 'runCommand', id: 3 });
  });

  it('setAutoCompile and setIncludeOnly need a boolean', () => {
    for (const command of ['setAutoCompile', 'setIncludeOnly']) {
      ok({ command, on: true });
      ok({ command, on: false });
      bad({ command, on: 'yes' });
      bad({ command });
    }
  });

  it('setEngine accepts the known engines only', () => {
    for (const engine of ['xelatex', 'pdflatex', 'lualatex']) { ok({ command: 'setEngine', engine }); }
    bad({ command: 'setEngine', engine: 'word' });
    bad({ command: 'setEngine' });
  });

  it('setCheckLimits accepts optional numbers, null and a countUpTo', () => {
    ok({ command: 'setCheckLimits', limits: {} });
    ok({ command: 'setCheckLimits', limits: { pages: 8, words: null, countUpTo: 'references' } });
    ok({ command: 'setCheckLimits', limits: { pages: null, countUpTo: 'end' } });
    bad({ command: 'setCheckLimits', limits: { pages: '8' } });
    bad({ command: 'setCheckLimits', limits: { words: undefined, countUpTo: 'middle' } });
    bad({ command: 'setCheckLimits', limits: { pages: Number.NaN } });
    bad({ command: 'setCheckLimits' });
    bad({ command: 'setCheckLimits', limits: 4 });
  });

  it('fixCitation accepts replace with its location, and update or add with a key', () => {
    ok({ command: 'fixCitation', fix: { kind: 'replace', key: 'smth', replacement: 'smith', file: 'main.tex', line: 4 } });
    ok({ command: 'fixCitation', fix: { kind: 'update', key: 'smith' } });
    ok({ command: 'fixCitation', fix: { kind: 'add', key: 'smith' } });
    bad({ command: 'fixCitation', fix: { kind: 'replace', key: 'smth', replacement: 'smith', file: 'main.tex' } });
    bad({ command: 'fixCitation', fix: { kind: 'replace', key: 'smth', file: 'main.tex', line: 4 } });
    bad({ command: 'fixCitation', fix: { kind: 'delete', key: 'smith' } });
    bad({ command: 'fixCitation', fix: { kind: 'add' } });
    bad({ command: 'fixCitation' });
  });

  it('openSourceLine needs a file and a line number', () => {
    ok({ command: 'openSourceLine', file: 'main.tex', line: 12 });
    bad({ command: 'openSourceLine', file: 'main.tex' });
    bad({ command: 'openSourceLine', line: 12 });
    bad({ command: 'openSourceLine', file: 'main.tex', line: '12' });
  });

  it('openCitedPaper takes an optional numeric page', () => {
    ok({ command: 'openCitedPaper', paperId: 'p' });
    ok({ command: 'openCitedPaper', paperId: 'p', page: 3 });
    bad({ command: 'openCitedPaper', paperId: 'p', page: '3' });
    bad({ command: 'openCitedPaper', page: 3 });
  });
});
