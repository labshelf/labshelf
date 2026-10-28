// Builds the global RegExp for a project search query and its Match Case, Regex and Whole Word options, and tells which project files the search reads.
import { formatError } from "../../errors/index.js";

const SEARCHABLE = /\.(?:tex|typ|bib|cls|sty|bst|txt|md|ya?ml|json|csv)$/i;

export interface SearchOptions {
  matchCase: boolean;
  regex: boolean;
  wholeWord: boolean;
}

/** Escapes text so a RegExp matches it literally. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The pattern, or `{ error }` when the query is empty or is not a valid regular expression. */
export function searchPattern(query: string, options: SearchOptions): RegExp | { error: string } {
  if (query === "") { return { error: "Type something to search for" }; }
  const source = options.regex ? query : escapeRegExp(query);
  try {
    return new RegExp(options.wholeWord ? `\\b(?:${source})\\b` : source, options.matchCase ? "g" : "gi");
  } catch (error) {
    return { error: formatError(error) };
  }
}

/** Tells whether a project file is text that Search in Project reads. */
export function isSearchTextFile(path: string): boolean {
  return SEARCHABLE.test(path);
}
