/**
 * Builds the searches the list runs for a click on a tag, an author or a keyword, in the core search language.
 */

const fieldTerms = (field: string, text: string): string =>
  text.toLowerCase().split(/\s+/).filter(Boolean).map((w) => `${field}:${w}`).join(" ");

/** Papers tagged `tag`; a tag of several words is quoted so it matches as one tag. */
export function createTagQuery(tag: string): string {
  // The query language has no escape for a quote, so quotes inside a tag are dropped.
  const name = tag.toLowerCase().replace(/"/g, "").split(/\s+/).filter(Boolean).join(" ");
  return name.includes(" ") ? `tag:"${name}"` : name ? `tag:${name}` : "";
}

/** Papers by an author, from their family name. */
export function createAuthorQuery(family: string): string {
  return fieldTerms("author", family);
}

/** Papers mentioning a keyword anywhere. */
export function createKeywordQuery(keyword: string): string {
  return keyword.toLowerCase();
}
