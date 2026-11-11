// The note files port (plan charts, D4/D5): a note reads and writes its own files under assets/ and picks a text file, through
// one request/reply message pair that each host protocol wraps with the note identity it already uses for note saves.
import { createReplyClient } from "../async/index.js";
import { base64ToBytes, bytesToBase64 } from "../encoding/index.js";
import { isRecord } from "../guards/index.js";
import { parseCsv, type ChartTable } from "./chart/index.js";

/** What a note editor may do with the files beside its note; hosts implement it, or post messages through createNoteFilesClient. */
export interface NoteFilesPort { read(path: string): Promise<Uint8Array | null>; write(path: string, bytes: Uint8Array): Promise<void>; pickTextFile(accept: readonly string[]): Promise<{ name: string; text: string } | null> }

/** A port call as a message, without the note identity the protocol adds around it. */
export type NoteFileRequest = { type: "noteFile.read"; requestId: string; path: string } | { type: "noteFile.write"; requestId: string; path: string; base64: string } | { type: "noteFile.pick"; requestId: string; accept: string[] }

/** The host's answer to one request: base64 null is a missing file, file null a cancelled pick (UTF-8 text, at most 10 MB), error a failure. */
export type NoteFileReply = { type: "noteFile.reply"; requestId: string; base64?: string | null; file?: { name: string; text: string } | null; error?: string }

/** The parsed table of `src`; no port, a missing file or a failed read give `missing` = "Data file <src> not found". */
export async function readChartSource(files: NoteFilesPort | undefined, src: string): Promise<{ table: ChartTable; missing: null } | { table: null; missing: string }> {
  const missing = { table: null, missing: `Data file ${src} not found` } as const;
  if (files === undefined) return missing;
  let bytes: Uint8Array | null;
  try {
    bytes = await files.read(src);
  } catch {
    return missing;
  }
  if (bytes === null) return missing;
  return { table: parseCsv(new TextDecoder().decode(bytes)).table, missing: null };
}

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

/** A port that posts each call as a NoteFileRequest and settles it on the reply with the same requestId; unsafe paths reject before anything is posted. */
export function createNoteFilesClient(post: (message: unknown) => void, onReply: (listener: (message: unknown) => void) => () => void): NoteFilesPort {
  const request = createReplyClient<NoteFileRequest, NoteFileReply>(post, onReply, isNoteFileReply);

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
