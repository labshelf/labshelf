// Declares the bibliographic fields a paper record, a registry answer and a parsed PDF all carry, and lists them once.

export interface BibliographicFields {
  authors?: string[] | undefined;
  year?: number | undefined;
  summary?: string | undefined;
  journal?: string | undefined;
  publisher?: string | undefined;
  volume?: string | undefined;
  issue?: string | undefined;
  pages?: string | undefined;
  doi?: string | undefined;
  url?: string | undefined;
  issn?: string | undefined;
  language?: string | undefined;
  /** Author or publisher supplied subject terms, when the PDF or a registry states them. */
  keywords?: string[] | undefined;
}

export const BIBLIOGRAPHIC_STRING_FIELDS = [
  "summary", "journal", "publisher", "volume", "issue", "pages", "doi", "url", "issn", "language",
] as const satisfies ReadonlyArray<keyof BibliographicFields>;

export const BIBLIOGRAPHIC_FIELDS = ["authors", "year", ...BIBLIOGRAPHIC_STRING_FIELDS, "keywords"] as const satisfies ReadonlyArray<keyof BibliographicFields>;
