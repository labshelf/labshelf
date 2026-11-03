// What the LabShelf editor asks of the extension host besides its text: the file's diagnostics (D8), the library's papers, paper notes, note insertables and the project's files, each backed by an existing VS Code service.
import * as vscode from "vscode";

import { SOURCE_EDITOR_ACTIONS, type ILogger, type NoteInsertSource, type PaperNotesStore, type PaperRecord, type SourceEditorAction, type SourceEditorInbound, type SourceEditorOutbound } from "@labshelf/core";
import type { SourceFileComments, SourceFileSuggestions } from "../../collab/index.js";
import { openSourceAt } from "../openSourceAt.js";

const MODULE = "writing/sourceEditor";
/** vscode.DiagnosticSeverity.Error and .Warning; everything else (information, hint) is shown as info. */
const SEVERITY_ERROR = 0;
const SEVERITY_WARNING = 1;
const MAX_LISTED_FILES = 5000;
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(["node_modules"]);

type ProblemsMessage = Extract<SourceEditorInbound, { type: "problems" }>;
type CommentsMessage = Extract<SourceEditorInbound, { type: "comments" }>;
type SuggestionsMessage = Extract<SourceEditorInbound, { type: "suggestions" }>;
type ReviewModeMessage = Extract<SourceEditorOutbound, { type: "reviewMode" }>;
/** The messages of the page that concern review mode: it asks to store or drop tracked changes and reports the mode it was set to. */
type ReviewMessage = Extract<SourceEditorOutbound, { type: "addSuggestions" | "removeSuggestions" | "reviewMode" }>;
/** The editor's review mode. */
export type SourceReviewMode = ReviewModeMessage["mode"];

/** Where the mode of the file's project is kept. */
export interface ReviewModeStore {
  get(): SourceReviewMode;
  set(mode: SourceReviewMode): void;
}

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
  /** The suggestion store for the file's tracked changes; undefined where it does not run (the web). */
  suggestions?: SourceFileSuggestions | undefined;
  /** The review mode of the file's project; undefined for a file in no project. */
  reviewMode?: ReviewModeStore | undefined;
  logger: ILogger;
}

export interface SourceBridges {
  /** Answers one request of the page; a rejection becomes an error response. */
  handle(method: string, params: unknown): Promise<unknown>;
  /** The file's diagnostics from every collection, read afresh. */
  problems(): ProblemsMessage;
  /** Posts the file's comment threads now and after each change, until the result is disposed; posts nothing without a port. */
  watchComments(post: (message: CommentsMessage) => void): vscode.Disposable;
  /** What the page needs to offer review: the project's stored mode and the author; undefined without a store and a project, which leaves the page without review. */
  review(): { mode: SourceReviewMode; author: string } | undefined;
  /** Posts the file's tracked changes now and after each change, until the result is disposed; posts nothing without a store. */
  watchSuggestions(post: (message: SuggestionsMessage) => void): vscode.Disposable;
  /** Applies one review message of the page: stores or drops tracked changes, or keeps the mode it picked. */
  receiveReview(message: ReviewMessage): Promise<void>;
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

function resolveInProject(projectRoot: vscode.Uri | undefined, path: string): { target: vscode.Uri; segments: string[] } {
  if (!projectRoot) { throw new Error("outside the project"); }
  const segments = relativeSegments(path);
  return { target: vscode.Uri.joinPath(projectRoot, ...segments), segments };
}

async function readProjectFile(projectRoot: vscode.Uri | undefined, path: string): Promise<string> {
  const { target } = resolveInProject(projectRoot, path);
  const key = target.toString();
  const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === key);
  if (open) { return open.getText(); }
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(target));
}

/** Project-relative paths of the files under a folder of the project, without dot folders and node_modules. */
async function listProjectFiles(projectRoot: vscode.Uri | undefined, path: string): Promise<string[]> {
  const { target, segments } = resolveInProject(projectRoot, path);
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

async function listFolder(projectRoot: vscode.Uri | undefined, params: unknown): Promise<string[]> {
  const folder = typeof params === "object" && params !== null ? (params as Record<string, unknown>).path : undefined;
  return await listProjectFiles(projectRoot, typeof folder === "string" ? folder : "");
}

async function openProjectFile(projectRoot: vscode.Uri | undefined, params: unknown): Promise<void> {
  const { target } = resolveInProject(projectRoot, stringParam(params, "path"));
  const line = typeof params === "object" && params !== null ? (params as Record<string, unknown>).line : undefined;
  await openSourceAt(target, typeof line === "number" ? line : undefined);
}

/** The talk and poster actions open the deck views of the editor's own file. */
const DECK_ACTIONS: Partial<Record<SourceEditorAction, string>> = { presentDeck: "labshelf.decks.present", posterPreview: "labshelf.decks.posterPreview" };

/** Runs a toolbar action as its labshelf.writing command, which acts on the focused LabShelf editor like the editor title buttons did; a talk or poster action runs its deck command on the file. */
async function runAction(uri: vscode.Uri, params: unknown): Promise<void> {
  const action = stringParam(params, "action");
  if (!(SOURCE_EDITOR_ACTIONS as readonly string[]).includes(action)) { throw new Error(`unknown action ${action}`); }
  const deckCommand = DECK_ACTIONS[action as SourceEditorAction];
  if (deckCommand) { await vscode.commands.executeCommand(deckCommand, uri); return; }
  await vscode.commands.executeCommand(`labshelf.writing.${action as SourceEditorAction}`);
}

function problemsOf(uri: vscode.Uri): ProblemsMessage {
  return {
    type: "problems",
    problems: vscode.languages.getDiagnostics(uri).map((diagnostic) => ({
      line: diagnostic.range.start.line + 1, severity: severityOf(diagnostic.severity), message: diagnostic.message,
    })),
  };
}

async function applyReview({ uri, suggestions, reviewMode }: SourceBridgeDeps, message: ReviewMessage): Promise<void> {
  if (message.type === "reviewMode") { reviewMode?.set(message.mode); return; }
  if (!suggestions) { throw new Error("suggestions work in the desktop app"); }
  const port = suggestions.suggestionsFor(uri);
  if (message.type === "addSuggestions") { await port.add(message.suggestions); } else { await port.remove(message.ids); }
}

async function addComment({ uri, comments }: SourceBridgeDeps, params: unknown): Promise<void> {
  if (!comments) { throw new Error("comments work in the desktop app"); }
  await comments.add(uri, { from: numberParam(params, "from"), to: numberParam(params, "to") }, stringParam(params, "text"));
}

export function createSourceBridges(deps: SourceBridgeDeps): SourceBridges {
  const { uri, projectRoot, library, notes, openNotes, comments, suggestions, reviewMode, logger } = deps;

  async function answer(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "papers": return await library.listPapers();
      case "readNote": return await notes.read(stringParam(params, "paperId"));
      case "listProjectNotes": return await notes.listProjectNotes();
      case "readProjectNote": return await notes.readProjectNote(stringParam(params, "path"));
      case "listCitedPaperIds": return await notes.listCitedPaperIds();
      case "readPaperNote": return await notes.readPaperNote(stringParam(params, "paperId"));
      case "openNotes": openNotes(stringParam(params, "paperId")); return undefined;
      case "readFile": return await readProjectFile(projectRoot, stringParam(params, "path"));
      case "listFiles": return await listFolder(projectRoot, params);
      case "openFile": await openProjectFile(projectRoot, params); return undefined;
      case "addComment": await addComment(deps, params); return undefined;
      case "openComments": await vscode.commands.executeCommand("workbench.panel.comments.focus"); return undefined;
      case "runAction": await runAction(uri, params); return undefined;
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
    review: () => suggestions && reviewMode ? { mode: reviewMode.get(), author: suggestions.author() } : undefined,
    watchSuggestions(post) {
      const stop = suggestions?.suggestionsFor(uri).subscribe((list) => post({ type: "suggestions", suggestions: list }));
      return { dispose: () => stop?.() };
    },
    async receiveReview(message) {
      try {
        await applyReview(deps, message);
      } catch (error) {
        void logger.error(MODULE, error, { action: message.type });
      }
    },
    problems: () => problemsOf(uri),
  };
}
