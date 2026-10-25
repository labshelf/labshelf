/** Unit tests for guessing a title from plain OCR lines. */

import { extractTitleFromPlainText } from '@labshelf/core';

describe('titleFromPlainText', () => {
  it('joins the title lines that sit directly above the byline', () => {
    const ocr = [
      'PLOS | one',
      'RESEARCH ARTICLE',
      'More than 75 percent decline over 27 years in',
      'total flying insect biomass in protected areas',
      "Caspar A. Hallmann'*, Martin Sorg?, Eelke Jongejans', Henk Siepel",
    ].join('\n');

    expect(extractTitleFromPlainText(ocr)).toBe(
      'More than 75 percent decline over 27 years in total flying insect biomass in protected areas',
    );
  });

  it('skips a notice printed above the title and the OCR specks around it', () => {
    const ocr = [
      'Provided proper attribution is provided, Google hereby grants permission to',
      'reproduce the tables and figures in this paper solely for use in journalistic or',
      'scholarly works.',
      'FE',
      'Attention Is All You Need',
      'of',
      'Ashish Vaswani* Noam Shazeer* Niki Parmar* Jakob Uszkoreit*',
    ].join('\n');

    expect(extractTitleFromPlainText(ocr)).toBe('Attention Is All You Need');
  });

  it('reads a title split by OCR symbol soup above names joined by "and"', () => {
    // OCR of the first page of a scanned Trends in Genetics paper.
    const ocr = [
      '-.',
      'From fitness landscapes to seascapes:',
      '[| | [_] [| -',
      'non-equilibrium dynamics of selection',
      'and adaptation',
      'Ville Mustonen and Michael Lassig',
      'Institut flr Theoretische Physik, Universitat zu Kéln, ZllpicherstraRe 77, 50937 Koln, Germany',
    ].join('\n');

    expect(extractTitleFromPlainText(ocr)).toBe('From fitness landscapes to seascapes: non-equilibrium dynamics of selection and adaptation');
  });

  it('does not take a Title Case title with lowercase function words for a byline', () => {
    const ocr = ['Selection Dynamics in Evolving Populations', 'Ann Lee and Bo Chen'].join('\n');
    expect(extractTitleFromPlainText(ocr)).toBe('Selection Dynamics in Evolving Populations');
  });

  it('returns undefined when no byline confirms a candidate', () => {
    const ocr = [
      'This document describes the internal procedures of the laboratory',
      'and must not be distributed outside of the department without consent',
    ].join('\n');

    expect(extractTitleFromPlainText(ocr)).toBeUndefined();
  });
});
