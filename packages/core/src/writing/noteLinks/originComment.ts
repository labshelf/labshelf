/** Hashes the equation an origin comment covers and finds where that comment starts in a line. */
import { deriveTextSha256Hex } from "../../hash/index.js";
import { ORIGIN_COMMENT } from "./originSyntax.js";

const HASH_LENGTH = 12;

/** First 12 lowercase hex chars of the SHA-256 of the trimmed LaTeX, the same shape as `deriveCodeHash`. */
export async function deriveOriginHash(latex: string): Promise<string> {
  return (await deriveTextSha256Hex(latex.trim())).slice(0, HASH_LENGTH);
}

/** Byte offset of the comment marker in a line that `parseOriginComment` accepts. */
export function findOriginCommentStart(line: string): number {
  return line.replace(/\r$/, "").search(ORIGIN_COMMENT);
}
