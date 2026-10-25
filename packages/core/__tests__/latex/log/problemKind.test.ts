// Tests that explained TeX messages carry the kind and subject the preview marks on the PDF.
import { explainTexMessage } from '../../../src/latex/log/explainTexMessage';

type Kinded = { kind?: string; subject?: string };
const explain = (m: Parameters<typeof explainTexMessage>[0]) => explainTexMessage(m, 'pdflatex') as (Kinded & object) | null;

describe('explainTexMessage kind and subject', () => {
  it('marks an undefined citation with its key', () => {
    const p = explain({ kind: 'warning', source: 'LaTeX', text: "Citation 'foo' on page 1 undefined on input line 12.", file: 'main.tex', line: 12 });
    expect(p).toMatchObject({ kind: 'undefinedCitation', subject: 'foo' });
  });

  it('marks an undefined reference with its label', () => {
    const p = explain({ kind: 'warning', source: 'LaTeX', text: "Reference `sec:x' on page 2 undefined on input line 30.", file: 'main.tex', line: 30 });
    expect(p).toMatchObject({ kind: 'undefinedReference', subject: 'sec:x' });
  });

  it('marks an overfull hbox without a subject', () => {
    const p = explain({ kind: 'badbox', text: 'Overfull \\hbox (12.5pt too wide) in paragraph at lines 10--11', file: 'main.tex', line: 10 });
    expect(p?.kind).toBe('overfull');
    expect(p?.subject).toBeUndefined();
  });

  it('leaves other messages without a kind', () => {
    expect(explain({ kind: 'error', text: 'Undefined control sequence.', context: '\\foo' })?.kind).toBeUndefined();
    expect(explain({ kind: 'warning', source: 'LaTeX', text: 'Float too large for page by 3pt on input line 5.' })?.kind).toBeUndefined();
    expect(explain({ kind: 'badbox', text: 'Underfull \\hbox (badness 10000) in paragraph at lines 3--4' })?.kind).toBeUndefined();
  });
});
