// Hashes a code cell's code into the `source` that tells whether a stored result is out of date.
// CONTRACT: documents/contracts/qmd-items.md#outputs
import { deriveTextSha256Hex } from "../../hash/index.js";

const SOURCE_LENGTH = 12;

/** `code` is the text between the cell's fences; `#|` option lines and line endings do not change the hash. */
export async function deriveCodeHash(code: string): Promise<string> {
  const lines = code.split(/\r\n|\n|\r/).filter((line) => !line.startsWith("#|"));
  const normalized = lines.join("\n").replace(/\n+$/, "");
  return (await deriveTextSha256Hex(normalized)).slice(0, SOURCE_LENGTH);
}
