// Converts offsets between a file's text and the editor document, which counts a CRLF line break as one character.
import type { Text } from "@codemirror/state";

/** The document offset of `offset` in the file text `fileText`. */
export function fileOffsetToDoc(fileText: string, offset: number): number {
  if (!fileText.includes("\r\n")) return offset;
  const before = fileText.slice(0, offset);
  return offset - (before.match(/\r\n/g)?.length ?? 0);
}

/** The file offset of document offset `offset`, for a file whose line break is `lineBreak`. */
export function docOffsetToFile(doc: Text, lineBreak: string, offset: number): number {
  return lineBreak === "\r\n" ? offset + doc.lineAt(offset).number - 1 : offset;
}
