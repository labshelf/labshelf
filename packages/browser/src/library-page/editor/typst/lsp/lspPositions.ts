// Converts project paths to the helper's `labshelf:/` document URIs and editor offsets to LSP positions, both ways.
// CONTRACT: documents/contracts/helper.md#messages
import type { Text } from "@codemirror/state";

export interface LspPosition { line: number; character: number }
export interface LspRange { start: LspPosition; end: LspPosition }

const PREFIX = "labshelf:/";

export function pageUri(path: string): string {
  return PREFIX + path.split("/").map(encodeURIComponent).join("/");
}

/** The project path of a `labshelf:/` URI, or undefined for any other URI. */
export function pathOfPageUri(uri: string): string | undefined {
  if (!uri.startsWith(PREFIX)) return undefined;
  try {
    return uri.slice(PREFIX.length).split("/").map(decodeURIComponent).join("/");
  } catch {
    return undefined;
  }
}

/** INVARIANT: both sides count UTF-16 code units, the LSP default position encoding. */
export function toLspPosition(doc: Text, offset: number): LspPosition {
  const line = doc.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
}

/** Clamps to the document, since a server's positions may refer to text that has changed since. */
export function toOffset(doc: Text, position: LspPosition): number {
  const line = doc.line(Math.min(Math.max(position.line, 0) + 1, doc.lines));
  return line.from + Math.min(Math.max(position.character, 0), line.length);
}
