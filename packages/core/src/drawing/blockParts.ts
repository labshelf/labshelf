// The part-by-part reader shared by the stored drawing and chart blocks: splits a fenced div into its inner lines and walks them, skipping blank lines.
export const FENCE = "```";
export const LATEX_FENCE = "```{=latex}";
export const CLOSE_DIV = ":::";
export const FI = "\\fi";
export const GUARD_CLOSE = "\\iffalse}\\makeatother";

/** Walks the div's inner lines part by part; each reader returns null when the next part is not what it expects. */
export class Parts {
  private at = 0;

  constructor(private readonly lines: readonly string[]) {}

  private skipBlank(): void {
    while (this.at < this.lines.length && this.lines[this.at]!.trim() === "") { this.at += 1; }
  }

  /** The body of the raw fence opened by `open` at the next non-blank line, joined with \n. */
  fence(open: string): string | null {
    this.skipBlank();
    if (this.lines[this.at] !== open) { return null; }
    const close = this.lines.indexOf(FENCE, this.at + 1);
    if (close < 0) { return null; }
    const body = this.lines.slice(this.at + 1, close).join("\n");
    this.at = close + 1;
    return body;
  }

  /** The next non-blank line without consuming it. */
  peek(): string | undefined {
    this.skipBlank();
    return this.lines[this.at];
  }

  /** The next non-blank line, consumed. */
  line(): string | null {
    const line = this.peek();
    if (line === undefined) { return null; }
    this.at += 1;
    return line;
  }

  /** True when only blank lines are left. */
  done(): boolean {
    this.skipBlank();
    return this.at === this.lines.length;
  }
}

/** The opener match and the inner parts of a div whose first line matches `opener` and last line closes it; null otherwise. */
export function openDiv(text: string, opener: RegExp): { opener: RegExpExecArray; parts: Parts } | null {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines.at(-1)!.trim() === "") { lines.pop(); }
  const match = opener.exec(lines[0] ?? "");
  if (!match || lines.length < 2 || lines.at(-1) !== CLOSE_DIV) { return null; }
  return { opener: match, parts: new Parts(lines.slice(1, -1)) };
}
