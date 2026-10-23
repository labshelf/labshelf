// Writes a parsed qmd item file back to text from the exact bytes each segment holds.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { ItemFile } from "./itemFile.js";

export function serializeItemFile(file: ItemFile): string {
  return file.segments.map((segment) => (segment.kind === "loose" ? segment.text : segment.fence + segment.body + segment.close)).join("");
}
