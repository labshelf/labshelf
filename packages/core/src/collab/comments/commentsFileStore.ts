// Loads and edits a project's comments.json through an injected file access, never writing a file it cannot read.
// CONTRACT: documents/contracts/library-format.md#project-folder-labshelf
import { COMMENTS_PATH, parseCommentsFile, serializeCommentsFile, type CommentsDocument } from "./commentsFile.js";

/** Reads and writes the text of one comments.json; the adapter creates missing folders on write. */
export interface CommentsFileAccess {
  /** The file's text, or undefined when there is none. */
  read(): Promise<string | undefined>;
  write(text: string): Promise<void>;
}

/** @returns the document (empty when the file is missing), or undefined when the file is not valid */
export async function loadCommentsDocument(access: CommentsFileAccess): Promise<CommentsDocument | undefined> {
  const text = await access.read();
  return text === undefined ? { threads: [] } : parseCommentsFile(text);
}

/** Applies `change` to a fresh read, so an edit made elsewhere since the last load is kept. */
export async function updateCommentsDocument(access: CommentsFileAccess, change: (doc: CommentsDocument) => CommentsDocument): Promise<void> {
  const doc = await loadCommentsDocument(access);
  if (!doc) { throw new Error(`${COMMENTS_PATH} is not valid JSON with a threads list, so it is left as it is`); }
  await access.write(serializeCommentsFile(change(doc)));
}
