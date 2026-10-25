/** Declares what the bibliography linter reports: findings on .bib entries and the edits that fix them. */

export type BibLintRule = "duplicate" | "missing-doi" | "published-version";

/** One text replacement in the linted file: offsets `start`–`end` become `text`. */
export interface BibFix {
  title: string;
  start: number;
  end: number;
  text: string;
}

export interface BibFinding {
  rule: BibLintRule;
  severity: "warning" | "information";
  message: string;
  /** The entry the finding is about. */
  key: string;
  /** Character offsets of that entry in the file. */
  start: number;
  end: number;
  /** Absent when no safe edit exists, or when the fix needs a network lookup (see `missingDoiFix`). */
  fix?: BibFix;
}
