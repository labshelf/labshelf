// Finds every match of a pattern in a text, line by line.

export interface TextMatch {
  /** 0-based. */
  line: number;
  /** 0-based, in UTF-16 code units. */
  column: number;
  length: number;
  lineText: string;
}

/** Matches never span lines. Zero-length matches are skipped because they select nothing. */
export function findInText(text: string, pattern: RegExp): TextMatch[] {
  const matches: TextMatch[] = [];
  const lines = text.split(/\r?\n/);
  for (const [line, lineText] of lines.entries()) {
    for (const match of lineText.matchAll(pattern)) {
      if (match[0].length > 0) { matches.push({ line, column: match.index, length: match[0].length, lineText }); }
    }
  }
  return matches;
}
