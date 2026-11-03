// Answers a note's file requests (plan charts, D4/D5) over a LibraryFileSystem and a host picker, shared by every host and surface.
import { base64ToBytes, bytesToBase64 } from "../encoding/index.js";
import { formatError } from "../errors/index.js";
import type { LibraryFileSystem } from "../ports/index.js";
import { safeNotePath, type NoteFileReply, type NoteFileRequest, type NoteFilesPort } from "./noteFiles.js";

/** A picked text file over this many UTF-16 code units is refused. */
const MAX_PICK_LENGTH = 10 * 1024 * 1024;

/** What a host gives to serve the files of the notes in one folder: the file system, its path join and its text file picker. */
export interface NoteFileIo { fs: Pick<LibraryFileSystem, 'stat' | 'readFile' | 'writeFile' | 'ensureDir'>; join(...parts: string[]): string; pick(accept: readonly string[]): Promise<{ name: string; text: string } | null> }

/** The segments of a safe note path; throws for a path safeNotePath refuses. */
function segmentsOf(path: string): string[] {
  const safe = safeNotePath(path);
  if (safe === null) { throw new Error(`Refused note file path ${path}`); }
  return safe.split("/");
}

/** A port over the files under `folder`, the folder that holds the note; writes rely on the fs's atomic writeFile. */
export function noteFilesPortFor(io: NoteFileIo, folder: string): NoteFilesPort {
  return {
    async read(path) {
      const target = io.join(folder, ...segmentsOf(path));
      const stat = await io.fs.stat(target);
      if (stat === undefined || !stat.isFile) { return null; }
      return io.fs.readFile(target);
    },
    async write(path, bytes) {
      const segments = segmentsOf(path);
      await io.fs.ensureDir(io.join(folder, ...segments.slice(0, -1)));
      await io.fs.writeFile(io.join(folder, ...segments), bytes);
    },
    async pickTextFile(accept) {
      const file = await io.pick(accept);
      if (file !== null && file.text.length > MAX_PICK_LENGTH) { throw new Error("File is larger than 10 MB"); }
      return file;
    },
  };
}

/** The reply of a surface whose host serves no note files. */
export function unsupportedNoteFileReply(request: NoteFileRequest): NoteFileReply {
  return { type: "noteFile.reply", requestId: request.requestId, error: "Note files are not supported here yet" };
}

/** The reply to one request; never rejects, a failure is the reply's error. */
export async function answerNoteFileRequest(io: NoteFileIo, folder: string, request: NoteFileRequest): Promise<NoteFileReply> {
  const reply = { type: "noteFile.reply" as const, requestId: request.requestId };
  const port = noteFilesPortFor(io, folder);
  try {
    switch (request.type) {
      case "noteFile.read": {
        const bytes = await port.read(request.path);
        return { ...reply, base64: bytes === null ? null : bytesToBase64(bytes) };
      }
      case "noteFile.write":
        await port.write(request.path, base64ToBytes(request.base64));
        return reply;
      case "noteFile.pick":
        return { ...reply, file: await port.pickTextFile(request.accept) };
    }
  } catch (error) {
    return { ...reply, error: formatError(error) };
  }
}
