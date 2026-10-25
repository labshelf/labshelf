// Declares the line merge with conflict markers that the item merge is given.

export interface TextMergeInput {
  readonly base: string;
  readonly local: string;
  readonly other: string;
  /** Names the other side in the closing conflict marker, e.g. the sync tool. */
  readonly otherLabel: string;
}

export interface TextMergeResult {
  readonly text: string;
  /** True when at least one overlapping edit is marked in the text. */
  readonly conflicted: boolean;
}

/** A line merge with conflict markers, injected so this domain stays runtime-neutral. */
export type TextMerge = (input: TextMergeInput) => TextMergeResult;
