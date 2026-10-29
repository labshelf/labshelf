/** Parses, formats and hashes the origin comment that ends an equation inserted from a note: `% labshelf: <note path>#<label> @<hash>`. */
import { deriveTextSha256Hex } from "../../hash/contentHash.js";

export interface OriginRef {
  notePath: string;
  label: string;
  hash: string;
}

const HASH_LENGTH = 12;

// The path is greedy so the label is whatever follows the last `#`.
const ORIGIN_COMMENT = /(?:%|\/\/)\s*labshelf:\s*(\S+)#([^\s#]+)\s+@([0-9a-f]{12})\s*$/;

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

/** First 12 lowercase hex chars of the SHA-256 of the trimmed LaTeX, the same shape as `deriveCodeHash`. */
export async function deriveOriginHash(latex: string): Promise<string> {
  return (await deriveTextSha256Hex(latex.trim())).slice(0, HASH_LENGTH);
}

/** Byte offset of the comment marker in a line that `parseOriginComment` accepts. */
export function findOriginCommentStart(line: string): number {
  return line.replace(/\r$/, "").search(ORIGIN_COMMENT);
}
