/**
 * Builds the searches the list runs for a click on a tag, an author or a keyword, in the core search language.
 */

const fieldTerms = (field: string, text: string): string =>
  text.toLowerCase().split(/\s+/).filter(Boolean).map((w) => `${field}:${w}`).join(" ");

/** Papers tagged `tag`; a tag of several words matches each word. */
export function tagQuery(tag: string): string {
  return fieldTerms("tag", tag);
}

/** Papers by an author, from their family name. */
export function authorQuery(family: string): string {
  return fieldTerms("author", family);
}

/** Papers mentioning a keyword anywhere. */
export function keywordQuery(keyword: string): string {
  return keyword.toLowerCase();
}
