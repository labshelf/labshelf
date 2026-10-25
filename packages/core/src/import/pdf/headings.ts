/** Declares the section-heading patterns that bound the abstract and keyword runs in front matter. */

// Headings that end the abstract. Matched case-sensitively — "since the
// introduction of the method" is prose, not a new section — and allowing the
// numbering styles journals print ("1 Introduction", "1. Introduction").
const SECTION_HEADINGS = ["Introduction", "Introdução", "Introducción", "Background", "Antecedentes"];
const KEYWORD_HEADINGS = ["Keywords", "Keyword", "Key words", "Index Terms", "Palavras-chave", "Palabras clave"];

export const ABSTRACT_STOP = headingPattern([...SECTION_HEADINGS, ...KEYWORD_HEADINGS]);
export const KEYWORDS_STOP = headingPattern([...SECTION_HEADINGS, "Abstract", "Resumo", "Resumen"]);

// Headings are printed either in title case or all caps; both spellings are
// listed so the pattern can stay case-sensitive and ignore running prose.
function headingPattern(words: string[]): RegExp {
  const alternatives = words.flatMap((word) => [word, word.toUpperCase()]).join("|");
  return new RegExp(`(?:^|\\n|\\s)(?:\\d{1,2}\\s*[.)]?\\s*)?(?:${alternatives})\\b`);
}

// Where the extracted run ends: at the next heading, or at the window's end.
export function stopIndex(window: string, stop: RegExp): number {
  const match = window.match(stop);
  return match?.index !== undefined ? match.index : window.length;
}
