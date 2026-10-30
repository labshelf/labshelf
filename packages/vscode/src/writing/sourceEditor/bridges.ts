// What the LabShelf editor asks of the extension host besides its text: the file's diagnostics (D8), the library's papers, paper notes, note insertables and the project's files, each backed by an existing VS Code service.
import * as vscode from "vscode";

import type { ILogger, NoteInsertSource, PaperNotesStore, PaperRecord, SourceEditorInbound } from "@labshelf/core";
import type { SourceFileComments } from "../../collab/comments.js";

const MODULE = "writing/sourceEditor";
/** vscode.DiagnosticSeverity.Error and .Warning; everything else (information, hint) is shown as info. */
const SEVERITY_ERROR = 0;
const SEVERITY_WARNING = 1;
const MAX_LISTED_FILES = 5000;
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(["node_modules"]);

type ProblemsMessage = Extract<SourceEditorInbound, { type: "problems" }>;
type CommentsMessage = Extract<SourceEditorInbound, { type: "comments" }>;

export interface SourceBridgeDeps {
  /** The file the editor shows, whose diagnostics it lists. */
  uri: vscode.Uri;
  /** The folder of the writing project the file belongs to; every file request is relative to it. Undefined when the file is in no project. */
  projectRoot: vscode.Uri | undefined;
  /** The open library's papers. */
  library: { listPapers(): Promise<PaperRecord[]> };
  notes: NoteInsertSource & Pick<PaperNotesStore, "read">;
  openNotes(paperId: string): void;
  /** The comment manager's port for the file's threads; undefined where it does not run (the web). */
  comments?: SourceFileComments | undefined;
  logger: ILogger;
}

export interface SourceBridges {
  /** Answers one request of the page; a rejection becomes an error response. */
  handle(method: string, params: unknown): Promise<unknown>;
  /** The file's diagnostics from every collection, read afresh. */
  problems(): ProblemsMessage;
  /** Posts the file's comment threads now and after each change, until the result is disposed; posts nothing without a port. */
  watchComments(post: (message: CommentsMessage) => void): vscode.Disposable;
}

function numberParam(params: unknown, key: string): number {
  const value = typeof params === "object" && params !== null ? (params as Record<string, unknown>)[key] : undefined;
  if (typeof value !== "number") { throw new Error(`missing ${key}`); }
  return value;
}

function severityOf(severity: number): "error" | "warning" | "info" {
  return severity === SEVERITY_ERROR ? "error" : severity === SEVERITY_WARNING ? "warning" : "info";
}

function stringParam(params: unknown, key: string): string {
  const value = typeof params === "object" && params !== null ? (params as Record<string, unknown>)[key] : undefined;
  if (typeof value !== "string") { throw new Error(`missing ${key}`); }
  return value;
}

/** The segments of a project-relative path; an absolute path, or one that climbs out of the folder, throws. */
function relativeSegments(path: string): string[] {
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) { throw new Error("outside the project"); }
  const segments: string[] = [];
  for (const segment of path.split(/[\\/]/)) {
    if (segment === "" || segment === ".") { continue; }
    if (segment === "..") {
      if (segments.length === 0) { throw new Error("outside the project"); }
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments;
}

export function createSourceBridges(deps: SourceBridgeDeps): SourceBridges {
  const { uri, projectRoot, library, notes, openNotes, comments, logger } = deps;

  async function addComment(params: unknown): Promise<void> {
    if (!comments) { throw new Error("comments work in the desktop app"); }
    await comments.add(uri, { from: numberParam(params, "from"), to: numberParam(params, "to") }, stringParam(params, "text"));
  }

  const resolve = (path: string): { target: vscode.Uri; segments: string[] } => {
    if (!projectRoot) { throw new Error("outside the project"); }
    const segments = relativeSegments(path);
    return { target: vscode.Uri.joinPath(projectRoot, ...segments), segments };
  };

  async function readFile(path: string): Promise<string> {
    const { target } = resolve(path);
    const key = target.toString();
    const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === key);
    if (open) { return open.getText(); }
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(target));
  }

  /** Project-relative paths of the files under a folder of the project, without dot folders and node_modules. */
  async function listFiles(path: string): Promise<string[]> {
    const { target, segments } = resolve(path);
    const files: string[] = [];
    const walk = async (folder: vscode.Uri, prefix: string[]): Promise<void> => {
      for (const [name, type] of await vscode.workspace.fs.readDirectory(folder)) {
        if (files.length >= MAX_LISTED_FILES) { return; }
        if (type & vscode.FileType.Directory) {
          if (name.startsWith(".") || SKIPPED_FOLDERS.has(name)) { continue; }
          await walk(vscode.Uri.joinPath(folder, name), [...prefix, name]);
        } else if (type & vscode.FileType.File) {
          files.push([...prefix, name].join("/"));
        }
      }
    };
    await walk(target, segments);
    return files.sort();
  }

  async function openFile(params: unknown): Promise<void> {
    const { target } = resolve(stringParam(params, "path"));
    const line = typeof params === "object" && params !== null ? (params as Record<string, unknown>).line : undefined;
    const options: vscode.TextDocumentShowOptions = {};
    if (typeof line === "number") {
      const at = new vscode.Position(Math.max(0, line - 1), 0);
      options.selection = new vscode.Range(at, at);
    }
    await vscode.window.showTextDocument(target, options);
  }

  async function answer(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "papers": return await library.listPapers();
      case "readNote": return await notes.read(stringParam(params, "paperId"));
      case "listProjectNotes": return await notes.listProjectNotes();
      case "readProjectNote": return await notes.readProjectNote(stringParam(params, "path"));
      case "listCitedPaperIds": return await notes.listCitedPaperIds();
      case "readPaperNote": return await notes.readPaperNote(stringParam(params, "paperId"));
      case "openNotes": openNotes(stringParam(params, "paperId")); return undefined;
      case "readFile": return await readFile(stringParam(params, "path"));
      case "listFiles": {
        const folder = typeof params === "object" && params !== null ? (params as Record<string, unknown>).path : undefined;
        return await listFiles(typeof folder === "string" ? folder : "");
      }
      case "openFile": await openFile(params); return undefined;
      case "addComment": await addComment(params); return undefined;
      case "openComments": await vscode.commands.executeCommand("workbench.panel.comments.focus"); return undefined;
      default: throw new Error(`not available: ${method}`);
    }
  }

  return {
    async handle(method, params) {
      try {
        return await answer(method, params);
      } catch (error) {
        void logger.error(MODULE, error, { action: method });
        throw error;
      }
    },
    watchComments(post) {
      return comments?.subscribe(uri, (ranges) => post({ type: "comments", ranges })) ?? { dispose: () => undefined };
    },
    problems() {
      return {
        type: "problems",
        problems: vscode.languages.getDiagnostics(uri).map((diagnostic) => ({
          line: diagnostic.range.start.line + 1, severity: severityOf(diagnostic.severity), message: diagnostic.message,
        })),
      };
    },
  };
}
