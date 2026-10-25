// Splits text into lines that keep their line endings, so joining the lines gives the text back byte for byte.
// CONTRACT: documents/contracts/qmd-items.md#format

const LINE_END = /\r\n|\n|\r/;

export function splitLines(text: string): string[] {
  return text.match(/[^\r\n]*(?:\r\n|\n|\r)|[^\r\n]+$/g) ?? [];
}

export function extractLineContent(line: string): string {
  return line.replace(/(?:\r\n|\n|\r)$/, "");
}

/** The line ending of the first line, or `\n` when the text has none. */
export function extractLineEnding(text: string): string {
  return LINE_END.exec(text)?.[0] ?? "\n";
}

export function isBlankLine(line: string): boolean {
  return /^[ \t]*$/.test(extractLineContent(line));
}
