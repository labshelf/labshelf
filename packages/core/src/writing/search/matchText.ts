// Finds every match of a pattern in a text, line by line, and computes the replacement text for one match if it still matches at its position.

export interface TextMatch {
  /** 0-based. */
  line: number;
  /** 0-based, in UTF-16 code units. */
  column: number;
  length: number;
  lineText: string;
}

/** Where a match sits in its line, in UTF-16 code units. */
export interface MatchSpan {
  column: number;
  length: number;
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

/**
 * The expanded replacement, or undefined when the pattern no longer matches exactly that span (the text changed).
 * `$1`, `$&` and `$<name>` work as in String.replace; `` $` `` and `$'` refer to the rest of the line, as matches never span lines.
 */
export function matchReplacement(lineText: string, pattern: RegExp, at: MatchSpan, replacement: string): string | undefined {
  const sticky = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}y`);
  sticky.lastIndex = at.column;
  const match = sticky.exec(lineText);
  if (!match || match[0].length !== at.length || at.length === 0) { return undefined; }
  return expandReplacement(replacement, match);
}

function expandReplacement(template: string, match: RegExpExecArray): string {
  const before = match.input.slice(0, match.index);
  const after = match.input.slice(match.index + match[0].length);
  return template.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]*>)/g, (token, key: string) => {
    if (key === "$") { return "$"; }
    if (key === "&") { return match[0]; }
    if (key === "`") { return before; }
    if (key === "'") { return after; }
    if (key.startsWith("<")) { return match.groups ? (match.groups[key.slice(1, -1)] ?? "") : token; }
    const index = Number(key);
    return index >= 1 && index < match.length ? (match[index] ?? "") : token;
  });
}
