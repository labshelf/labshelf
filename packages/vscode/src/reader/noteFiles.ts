/** The VS Code note file io (plan charts, D4/D5): files beside a note through the library file system, and the host's file pick. */
import * as vscode from "vscode";
import { answerNoteFileRequest, type NoteFileIo, type NoteFileReply, type NoteFileRequest } from "@labshelf/core";

/** The text file the user picks in the open dialog, or null when the dialog is cancelled. */
async function pickTextFile(accept: readonly string[]): Promise<{ name: string; text: string } | null> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { Data: accept.map((extension) => extension.replace(/^\./, "")) },
    openLabel: "Import",
  });
  const uri = picked?.[0];
  if (uri === undefined) { return null; }
  const bytes = await vscode.workspace.fs.readFile(uri);
  const name = uri.fsPath.split(/[\\/]/).pop() ?? uri.fsPath;
  return { name, text: new TextDecoder("utf-8").decode(bytes) };
}

/** The io the VS Code surfaces serve a note's files through: the library file system for reads and writes, the open dialog for picks. */
export function createVsCodeNoteFileIo(fs: NoteFileIo["fs"], join: (...parts: string[]) => string): NoteFileIo {
  return { fs, join, pick: pickTextFile };
}

const unavailable = (): never => { throw new Error("This window cannot reach the library files"); };

/** An io whose file system refuses every access, for a surface that has no library file system yet; picks still work. */
export function createUnavailableNoteFileIo(join: (...parts: string[]) => string): NoteFileIo {
  return createVsCodeNoteFileIo({ stat: unavailable, readFile: unavailable, writeFile: unavailable, ensureDir: unavailable }, join);
}

/** The paper hook of the library pane: a paper note's assets live in the paper's own folder. */
export function createPaperNoteFiles(io: NoteFileIo, papers: (ids: readonly string[]) => Promise<readonly { path: string }[]>): (paperId: string, request: NoteFileRequest) => Promise<NoteFileReply> {
  return async (paperId, request) => {
    const [paper] = await papers([paperId]);
    if (paper === undefined) { return { type: "noteFile.reply", requestId: request.requestId, error: "The paper is not in the library" }; }
    return answerNoteFileRequest(io, paper.path, request);
  };
}

/**
 * The Spaces hook: a Space note's files sit beside it, so notes/x.qmd keeps its assets in spaces/<id>/notes/assets/.
 * @param spaceDir the Space's folder in the library, from the library layout.
 */
export function createSpaceNoteFiles(io: NoteFileIo, spaceDir: (spaceId: string) => string): (spaceId: string, notePath: string, request: NoteFileRequest) => Promise<NoteFileReply> {
  return async (spaceId, notePath, request) => {
    const parents = notePath.split("/").slice(0, -1);
    if (parents.some((part) => part === "" || part === "." || part === "..")) {
      return { type: "noteFile.reply", requestId: request.requestId, error: `Refused note path ${notePath}` };
    }
    return answerNoteFileRequest(io, io.join(spaceDir(spaceId), ...parents), request);
  };
}
