// The note files port (plan charts, D4/D5): a note reads and writes its own files under assets/ and picks a text file, through
// one request/reply message pair that each host protocol wraps with the note identity it already uses for note saves.
import { base64ToBytes, bytesToBase64 } from "../encoding/base64.js";
import { isRecord } from "../guards/record.js";

/** What a note editor may do with the files beside its note; hosts implement it, or post messages through createNoteFilesClient. */
export interface NoteFilesPort { read(path: string): Promise<Uint8Array | null>; write(path: string, bytes: Uint8Array): Promise<void>; pickTextFile(accept: readonly string[]): Promise<{ name: string; text: string } | null> }

/** A port call as a message, without the note identity the protocol adds around it. */
export type NoteFileRequest = { type: "noteFile.read"; requestId: string; path: string } | { type: "noteFile.write"; requestId: string; path: string; base64: string } | { type: "noteFile.pick"; requestId: string; accept: string[] }

/** The host's answer to one request: base64 null is a missing file, file null a cancelled pick (UTF-8 text, at most 10 MB), error a failure. */
export type NoteFileReply = { type: "noteFile.reply"; requestId: string; base64?: string | null; file?: { name: string; text: string } | null; error?: string }

/** The path when it is a relative POSIX path under assets/ with no empty, '.' or '..' segment, backslash or drive letter; else null. */
export function safeNotePath(path: string): string | null {
  if (typeof path !== "string" || path.includes("\\") || /^[A-Za-z]:/.test(path)) { return null; }
  const segments = path.split("/");
  if (segments.length < 2 || segments[0] !== "assets") { return null; }
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) { return null; }
  return path;
}

/** True for a well-formed request whose path, when it has one, safeNotePath accepts. */
export function isNoteFileRequest(raw: unknown): raw is NoteFileRequest {
  if (!isRecord(raw) || typeof raw["requestId"] !== "string") { return false; }
  switch (raw["type"]) {
    case "noteFile.read":
      return typeof raw["path"] === "string" && safeNotePath(raw["path"]) !== null;
    case "noteFile.write":
      return typeof raw["path"] === "string" && safeNotePath(raw["path"]) !== null && typeof raw["base64"] === "string";
    case "noteFile.pick":
      return Array.isArray(raw["accept"]) && raw["accept"].every((entry) => typeof entry === "string");
    default:
      return false;
  }
}

/** True for a well-formed reply. */
export function isNoteFileReply(raw: unknown): raw is NoteFileReply {
  if (!isRecord(raw) || raw["type"] !== "noteFile.reply" || typeof raw["requestId"] !== "string") { return false; }
  const base64 = raw["base64"];
  if (base64 !== undefined && base64 !== null && typeof base64 !== "string") { return false; }
  const error = raw["error"];
  if (error !== undefined && typeof error !== "string") { return false; }
  const file = raw["file"];
  if (file === undefined || file === null) { return true; }
  return isRecord(file) && typeof file["name"] === "string" && typeof file["text"] === "string";
}

type Pending = (reply: NoteFileReply) => void;

/** A port that posts each call as a NoteFileRequest and settles it on the reply with the same requestId; unsafe paths reject before anything is posted. */
export function createNoteFilesClient(post: (message: unknown) => void, onReply: (listener: (message: unknown) => void) => () => void): NoteFilesPort {
  const pending = new Map<string, Pending>();
  const prefix = Math.random().toString(36).slice(2, 10);
  let counter = 0;
  let unsubscribe: (() => void) | null = null;

  const listen = (message: unknown): void => {
    if (!isNoteFileReply(message)) { return; }
    const settle = pending.get(message.requestId);
    if (settle === undefined) { return; }
    pending.delete(message.requestId);
    if (pending.size === 0 && unsubscribe !== null) { unsubscribe(); unsubscribe = null; }
    settle(message);
  };

  const request = <T>(build: (requestId: string) => NoteFileRequest, read: (reply: NoteFileReply) => T): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      counter += 1;
      const requestId = `${prefix}-${counter}`;
      pending.set(requestId, (reply) => {
        if (reply.error !== undefined) { reject(new Error(reply.error)); return; }
        try { resolve(read(reply)); } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
      });
      if (unsubscribe === null) { unsubscribe = onReply(listen); }
      post(build(requestId));
    });

  const checked = (path: string): string => {
    const safe = safeNotePath(path);
    if (safe === null) { throw new Error(`Refused note file path ${path}`); }
    return safe;
  };

  return {
    async read(path) {
      const safe = checked(path);
      return request((requestId) => ({ type: "noteFile.read", requestId, path: safe }), (reply) => (typeof reply.base64 === "string" ? base64ToBytes(reply.base64) : null));
    },
    async write(path, bytes) {
      const safe = checked(path);
      const base64 = bytesToBase64(bytes);
      return request((requestId) => ({ type: "noteFile.write", requestId, path: safe, base64 }), () => undefined);
    },
    async pickTextFile(accept) {
      return request((requestId) => ({ type: "noteFile.pick", requestId, accept: [...accept] }), (reply) => reply.file ?? null);
    },
  };
}
