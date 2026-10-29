/** Parses and formats the origin comment that ends an equation inserted from a note: `% labshelf: <note path>#<label> @<hash>`. */
export interface OriginRef {
  notePath: string;
  label: string;
  hash: string;
}

// The path is greedy so the label is whatever follows the last `#`.
export const ORIGIN_COMMENT = /(?:%|\/\/)\s*labshelf:\s*(\S+)#([^\s#]+)\s+@([0-9a-f]{12})\s*$/;

/** Returns the origin a line's comment names, or undefined when the line has none or it is malformed. */
export function parseOriginComment(line: string): OriginRef | undefined {
  const match = ORIGIN_COMMENT.exec(line.replace(/\r$/, ""));
  if (!match) { return undefined; }
  const [, notePath, label, hash] = match as unknown as [string, string, string, string];
  return { notePath, label, hash };
}

export function formatOriginComment(language: "latex" | "typst", origin: OriginRef): string {
  const marker = language === "latex" ? "%" : "//";
  return `${marker} labshelf: ${origin.notePath}#${origin.label} @${origin.hash}`;
}
