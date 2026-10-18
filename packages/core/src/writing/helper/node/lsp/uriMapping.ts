// Maps document URIs between the page's `labshelf:/<path>` form and the `file:` URIs of a project's working copy, anywhere in a JSON-RPC payload.
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { checkHelperPath } from "../../index.js";

const PAGE_SCHEME = "labshelf:";
const PAGE_PREFIX = "labshelf:/";
const FILE_SCHEME = "file:";

export class UriRefusedError extends Error {}

/** The `file:` URI of a working-copy path; the root itself for an empty path. */
export function fileUriOf(rootDir: string, relative: string): string {
  return pathToFileURL(path.join(rootDir, relative)).href;
}

function toFileUri(uri: string, rootDir: string): string {
  const encoded = uri.slice(PAGE_PREFIX.length).replace(/^\/+/, "");
  if (encoded === "") { return fileUriOf(rootDir, ""); }
  let relative: string;
  try { relative = decodeURIComponent(encoded); } catch { throw new UriRefusedError(`"${uri}" is not a valid URI`); }
  const reason = checkHelperPath(relative);
  if (reason) { throw new UriRefusedError(`"${uri}" is refused: ${reason}`); }
  return fileUriOf(rootDir, relative);
}

function toPageUri(uri: string, rootDir: string): string | undefined {
  let file: string;
  try { file = fileURLToPath(uri); } catch { return undefined; }
  const relative = path.relative(rootDir, file);
  if (relative === "") { return PAGE_PREFIX; }
  if (relative.startsWith("..") || path.isAbsolute(relative)) { return undefined; }
  return PAGE_PREFIX + relative.split(path.sep).map(encodeURIComponent).join("/");
}

// Document text is content, never a URI, so a file that begins with "file:" is not refused.
const TEXT_KEYS = new Set(["text", "newText"]);

// Object keys are mapped too: a WorkspaceEdit's `changes` is keyed by URI. A key that maps to null is omitted.
function walk(value: unknown, map: (text: string) => string | null): unknown {
  if (typeof value === "string") { return map(value); }
  if (Array.isArray(value)) { return value.map((item) => walk(item, map)); }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).map(([key, item]) =>
      [map(key), TEXT_KEYS.has(key) && typeof item === "string" ? item : walk(item, map)] as const);
    return Object.fromEntries(entries.filter(([key]) => key !== null));
  }
  return value;
}

/** @throws UriRefusedError when a page URI does not name a safe project path */
export function pageUrisToFiles(payload: unknown, rootDir: string): unknown {
  return walk(payload, (text) => {
    // A raw `file:` string would name a path on the computer, past the working copy.
    if (text.slice(0, FILE_SCHEME.length).toLowerCase() === FILE_SCHEME) { throw new UriRefusedError("A file: URI is not a project path"); }
    return text.startsWith(PAGE_SCHEME) ? toFileUri(text, rootDir) : text;
  });
}

/** A `file:` URI outside the working copy becomes null (an object key is omitted) and is listed in `outside`, so the caller can log or drop the message. */
export function fileUrisToPage(payload: unknown, rootDir: string): { payload: unknown; outside: string[] } {
  const outside: string[] = [];
  const mapped = walk(payload, (text) => {
    if (!text.startsWith(FILE_SCHEME)) { return text; }
    const page = toPageUri(text, rootDir);
    if (page === undefined) { outside.push(text); }
    return page ?? null;
  });
  return { payload: mapped, outside };
}

/**
 * The page drives `initialize`, but the project root is the working copy whatever root it names.
 * TRAP: `tinymist lsp` has no root flag, and its initialization options can set `rootPath` and `typstExtraArgs`, so they are replaced.
 */
export function rootInitialize(message: Record<string, unknown>, rootDir: string): Record<string, unknown> {
  if (message.method !== "initialize" || typeof message.params !== "object" || message.params === null) { return message; }
  const { rootPath: _rootPath, ...params } = message.params as Record<string, unknown>;
  const uri = fileUriOf(rootDir, "");
  return { ...message, params: { ...params, rootUri: uri, workspaceFolders: [{ uri, name: "project" }], initializationOptions: {} } };
}
