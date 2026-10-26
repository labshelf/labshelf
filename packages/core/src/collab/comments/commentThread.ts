// Defines a comment thread and reads one from untrusted JSON, keeping only what this version understands.
// CONTRACT: documents/contracts/library-format.md#project-folder-labshelf

/** The text a thread is on; `start` and `end` are base64 Yjs relative positions, present only in a shared project. */
export interface CommentAnchor {
  quote: string;
  prefix: string;
  suffix: string;
  start?: string;
  end?: string;
}

export interface Comment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface CommentThread {
  id: string;
  /** POSIX path of the text file, relative to the project folder. */
  file: string;
  anchor: CommentAnchor;
  /** Oldest first, never empty. */
  comments: Comment[];
  resolved: boolean;
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";
const isTimestamp = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

function readAnchor(value: unknown): CommentAnchor | undefined {
  if (!isJsonObject(value)) { return undefined; }
  const { quote, prefix, suffix, start, end } = value;
  if (!isText(quote) || typeof prefix !== "string" || typeof suffix !== "string") { return undefined; }
  const live = isText(start) && isText(end) ? { start, end } : {};
  return { quote, prefix, suffix, ...live };
}

function readComment(value: unknown): Comment | undefined {
  if (!isJsonObject(value)) { return undefined; }
  const { id, author, body, createdAt } = value;
  return isText(id) && isText(author) && isText(body) && isTimestamp(createdAt) ? { id, author, body, createdAt } : undefined;
}

/**
 * The file and the share come from other machines, so every key is checked.
 * @returns undefined when a key of the thread is missing or invalid; invalid comments are left out
 */
export function readThread(value: unknown): CommentThread | undefined {
  if (!isJsonObject(value)) { return undefined; }
  const { id, file, resolved } = value;
  const anchor = readAnchor(value["anchor"]);
  if (!isText(id) || !isText(file) || typeof resolved !== "boolean" || !anchor || !Array.isArray(value["comments"])) { return undefined; }
  const comments = value["comments"].map(readComment).filter((each): each is Comment => each !== undefined);
  return comments.length === 0 ? undefined : { id, file, anchor, comments, resolved };
}

/** Earliest first comment first, then by id, so every member lists and writes threads in one order. */
export function compareThreads(a: CommentThread, b: CommentThread): number {
  const byTime = Date.parse(a.comments[0]!.createdAt) - Date.parse(b.comments[0]!.createdAt);
  return byTime !== 0 ? byTime : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
