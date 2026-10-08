/** The operators of the query language with an example each, for help overlays and tooltips. */

export interface SyntaxHelpRow {
  syntax: string;
  description: string;
}

export const SYNTAX_HELP: readonly SyntaxHelpRow[] = [
  { syntax: "word \"a phrase\"", description: "every word must match; -word excludes" },
  { syntax: "tag:nlp  #nlp", description: "has a tag" },
  { syntax: "status:reading  is:r", description: "unread, reading, done" },
  { syntax: "year:2015..2020", description: "publication year; also year:2017, >2018, <2000" },
  { syntax: "author:vaswani", description: "author" },
  { syntax: "kw:graphs  note:todo", description: "keywords, note; also venue:, key:, abstract:" },
  { syntax: "has:pdf  no:pdf", description: "also has:note, has:doi, has:tags, has:abstract" },
];
