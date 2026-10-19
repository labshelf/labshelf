// Declares the messages between the project search page and its host, and the channel that carries them.
import type { MessageEnd } from "../../../library-ui/protocol/index.js";
import type { SearchOptions } from "../searchPattern.js";
import type { SearchResults } from "../searchResults.js";

/** "file" searches only the active file, "project" every searchable file of its project. */
export type SearchScopeMode = "file" | "project";

/** A match the page points at; line and column are 0-based. */
export interface MatchLocation {
  path: string;
  line: number;
  column: number;
  length: number;
}

export type SearchToHost =
  | { type: "ready" }
  | { type: "search"; query: string; options: SearchOptions; scope: SearchScopeMode }
  | ({ type: "open" } & MatchLocation)
  | ({ type: "replace"; replacement: string } & MatchLocation)
  | { type: "replaceFile"; path: string; replacement: string }
  | { type: "replaceAll"; replacement: string };

/** What a search covers, as the page names it. */
export interface SearchScopeLabel {
  project: string;
  folder: string;
  /** The active file, relative to the project folder; null when the host has no active file, which hides the "This file" choice. */
  file: string | null;
}

export type HostToSearch =
  | { type: "seed"; query: string }
  /** `null` while the active file belongs to no writing project. */
  | { type: "scope"; scope: SearchScopeLabel | null }
  | { type: "results"; results: SearchResults }
  /** The query is not searchable, such as an invalid regular expression. */
  | { type: "invalid"; message: string };

/** The page side of the channel. */
export type SearchTransport = MessageEnd<SearchToHost, HostToSearch>;
