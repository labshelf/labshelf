// What the LabShelf editor asks of the extension host besides its text: the file's diagnostics (D8), the library's papers, paper notes, note insertables and the project's files, each backed by an existing VS Code service.
import * as vscode from "vscode";

import { SOURCE_EDITOR_ACTIONS, type Annotation, type DictionaryStore, type ILogger, type NoteInsertSource, type PaperNotesStore, type PaperRecord, type SourceEditorAction, type SourceEditorInbound, type SourceEditorOutbound } from "@labshelf/core";
import type { SourceFileComments, SourceFileSuggestions } from "../../collab/index.js";
import { openSourceAt } from "../openSourceAt.js";
import { listWorkspaceCodeFiles, openCodeFileAt } from "../codeSource.js";
import { readCodeFile, resolveCodeFile } from "./codeFiles.js";

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
  /** A paper's highlights, for citing one and the cite hover. */
  highlightsOf?(paperId: string): Promise<Annotation[]>;
  /** Opens a paper in the reader, at a page when given. */
  openPaper?(paperId: string, page?: number): void;
  /** The comment manager's port for the file's threads; undefined where it does not run (the web). */
  comments?: SourceFileComments | undefined;
  /** The suggestion store for the file's tracked changes; undefined where it does not run (the web). */
  suggestions?: SourceFileSuggestions | undefined;
  /** The review mode of the file's project; undefined for a file in no project. */
  reviewMode?: ReviewModeStore | undefined;
  /** The machine-local spelling dictionaries and the user's words; undefined where there are none. */
  dictionaries?: DictionaryStore | undefined;
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

function optionalNumber(params: unknown, key: string): number | undefined {
  const value = typeof params === "object" && params !== null ? (params as Record<string, unknown>)[key] : undefined;
  return typeof value === "number" ? value : undefined;
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

/** Opens a project file at its line; `preserveFocus` (Split following the selection) opens it beside and keeps the focus in the deck. */
async function openProjectFile(projectRoot: vscode.Uri | undefined, params: unknown): Promise<void> {
  const { target } = resolveInProject(projectRoot, stringParam(params, "path"));
  const record = typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {};
  const line = typeof record.line === "number" ? record.line : undefined;
  await openSourceAt(target, line, record.preserveFocus === true ? { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true } : {});
}

/** The talk and poster actions open the deck views of the editor's own file. */
const DECK_ACTIONS: Partial<Record<SourceEditorAction, string>> = { presentDeck: "labshelf.decks.present", posterPreview: "labshelf.decks.posterPreview" };

/** The Project chat toggle is the side bar view's own command. */
const HOST_COMMANDS: Partial<Record<SourceEditorAction, string>> = { toggleProjectChat: "labshelf.projectChat.toggle" };

/** Runs a toolbar action as its labshelf.writing command, which acts on the focused LabShelf editor like the editor title buttons did; a talk or poster action runs its deck command on the file. */
async function runAction(uri: vscode.Uri, params: unknown): Promise<void> {
  const action = stringParam(params, "action");
  if (!(SOURCE_EDITOR_ACTIONS as readonly string[]).includes(action)) { throw new Error(`unknown action ${action}`); }
  const deckCommand = DECK_ACTIONS[action as SourceEditorAction];
  if (deckCommand) { await vscode.commands.executeCommand(deckCommand, uri); return; }
  const hostCommand = HOST_COMMANDS[action as SourceEditorAction];
  await vscode.commands.executeCommand(hostCommand ?? `labshelf.writing.${action as SourceEditorAction}`);
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

/** Stores the math preview as off for every LaTeX file and says where to turn it back on. */
async function disableMathPreview(): Promise<void> {
  await vscode.workspace.getConfiguration("labshelf.writing").update("mathPreview", false, vscode.ConfigurationTarget.Global);
  // Not awaited: the request answers at once, the message stays until dismissed.
  void vscode.window.showInformationMessage("Math preview is off. Turn it back on in Settings: LabShelf › Writing: Math Preview.", "Open Settings").then((picked) => {
    if (picked) { void vscode.commands.executeCommand("workbench.action.openSettings", "labshelf.writing.mathPreview"); }
  });
}

/** Stores proofing as off for every file and says where to turn it back on. */
async function disableSpelling(): Promise<void> {
  await vscode.workspace.getConfiguration("labshelf.writing").update("spelling", false, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage("Spelling and style checks are off. Turn them back on in Settings: LabShelf › Writing: Spelling.", "Open Settings").then((picked) => {
    if (picked) { void vscode.commands.executeCommand("workbench.action.openSettings", "labshelf.writing.spelling"); }
  });
}

function dictionariesOf({ dictionaries }: SourceBridgeDeps): DictionaryStore {
  if (!dictionaries) { throw new Error("spelling dictionaries are not available here"); }
  return dictionaries;
}

/** Answers one request of the page: the library, the notes, the project's files, comments, actions and the dictionaries. */
async function answer(deps: SourceBridgeDeps, method: string, params: unknown): Promise<unknown> {
  const { uri, projectRoot, library, notes, openNotes, highlightsOf, openPaper } = deps;
  switch (method) {
    case "papers": return await library.listPapers();
    case "readNote": return await notes.read(stringParam(params, "paperId"));
    case "listProjectNotes": return await notes.listProjectNotes();
    case "readProjectNote": return await notes.readProjectNote(stringParam(params, "path"));
    case "listCitedPaperIds": return await notes.listCitedPaperIds();
    case "readPaperNote": return await notes.readPaperNote(stringParam(params, "paperId"));
    case "openNotes": openNotes(stringParam(params, "paperId")); return undefined;
    case "highlightsOf": return await highlightsOf?.(stringParam(params, "paperId")) ?? [];
    case "openPaper": openPaper?.(stringParam(params, "paperId"), optionalNumber(params, "page")); return undefined;
    case "readFile": return await readProjectFile(projectRoot, stringParam(params, "path"));
    case "listFiles": return await listFolder(projectRoot, params);
    case "listCodeFiles": return projectRoot ? await listWorkspaceCodeFiles(projectRoot) : [];
    case "readCodeFile": return await readCodeFile(projectRoot, stringParam(params, "path"));
    case "openCodeFile": await openCodeFileAt(resolveCodeFile(projectRoot, stringParam(params, "path")), optionalNumber(params, "line")); return undefined;
    case "openFile": await openProjectFile(projectRoot, params); return undefined;
    case "addComment": await addComment(deps, params); return undefined;
    case "openComments": await vscode.commands.executeCommand("workbench.panel.comments.focus"); return undefined;
    case "runAction": await runAction(uri, params); return undefined;
    case "disableMathPreview": await disableMathPreview(); return undefined;
    case "disableSpelling": await disableSpelling(); return undefined;
    case "dictionaryList": return await dictionariesOf(deps).list();
    case "dictionaryRead": return await dictionariesOf(deps).read(stringParam(params, "tag"));
    case "dictionaryInstall": await dictionariesOf(deps).install(stringParam(params, "tag")); return undefined;
    case "userWords": return await dictionariesOf(deps).userWords();
    case "addUserWord": await dictionariesOf(deps).addUserWord(stringParam(params, "word")); return undefined;
    default: throw new Error(`not available: ${method}`);
  }
}

export function createSourceBridges(deps: SourceBridgeDeps): SourceBridges {
  const { uri, comments, suggestions, reviewMode, logger } = deps;
  return {
    async handle(method, params) {
      try {
        return await answer(deps, method, params);
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
