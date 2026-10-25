// Builds the global RegExp for a project search query and its Match Case, Regex and Whole Word options.
import { escapeRegExp } from "./escapePattern.js";

export interface SearchOptions {
  matchCase: boolean;
  regex: boolean;
  wholeWord: boolean;
}

/** The pattern, or `{ error }` when the query is empty or is not a valid regular expression. */
export function searchPattern(query: string, options: SearchOptions): RegExp | { error: string } {
  if (query === "") { return { error: "Type something to search for" }; }
  const source = options.regex ? query : escapeRegExp(query);
  try {
    return new RegExp(options.wholeWord ? `\\b(?:${source})\\b` : source, options.matchCase ? "g" : "gi");
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
