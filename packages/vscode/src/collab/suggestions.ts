// Stores the tracked changes of the LabShelf source editor's review mode per source file: over comments.qmd in a local project and over the share's suggestions in a shared one.
// CONTRACT: documents/contracts/collaboration.md#comments
import * as vscode from "vscode";

import {
  addSuggestions,
  COMMENTS_PATH,
  createSharedProjectSuggestions,
  deriveSuggestionAnchor,
  deriveSuggestions,
  findSuggestion,
  isInside,
  loadCommentsDocument,
  removeSuggestions,
  toFileSuggestion,
  toSuggestion,
  updateCommentsDocument,
  type EditorSuggestions,
  type FileSuggestion,
  type CommentsFileAccess,
  type ILogger,
  type SharedProjectSuggestions,
  type Suggestion,
  type TextRange,
} from "@labshelf/core";
import type { WritingProjects } from "../writing/index.js";
import { walkLf } from "./comments.js";
import { reconcileProjects } from "./projectEntries.js";
import { type CommentShare, createProjectFileUri, readTextFile } from "./threads.js";

const SUGGESTIONS_LOG_MODULE = "collab.suggestions";
const DEFAULT_AUTHOR = "Unknown";

export type { FileSuggestion };

/** What the LabShelf editor asks of the suggestion store for its file; offsets are in the file's LF text. */
export interface SourceFileSuggestions {
  /** The editor's review port for the file; outside every open project it lists nothing and refuses to add. */
  suggestionsFor(uri: vscode.Uri): EditorSuggestions;
  /** The name a new suggestion is recorded under: the extension's user name, the one a share shows. */
  author(): string;
}

/** How a local project's files are reached. */
export interface SuggestionFiles {
  /** Reads and writes the project's comments.qmd. */
  comments(folder: string): CommentsFileAccess;
  /** The text of a project file, the open document's when it is open. */
  textOf(folder: string, file: string): Promise<string | undefined>;
  /** Calls `onChange` when comments.qmd changes on disk; returns the stop. */
  watch(folder: string, onChange: () => void): () => void;
}

export interface SuggestionsDeps {
  projects: Pick<WritingProjects, "list" | "onDidChange" | "paths">;
  shares: { list(): readonly CommentShare[]; readonly onDidChange: vscode.Event<void> };
  logger: ILogger;
  /** The name new suggestions carry; the extension's user name. */
  author?: string;
  /** The file access of a local project; VS Code's by default. */
  files?: SuggestionFiles;
  /** The suggestions of a live share; core's over the share's session by default. */
  sharedSuggestions?: (share: CommentShare) => SharedProjectSuggestions;
}

const toFileOffset = (text: string, lf: number): number => walkLf(text, (_, reached) => reached >= lf).file;
const toLfOffset = (text: string, file: number): number => walkLf(text, (reached) => reached >= file).lf;

/** The suggestions of `file` that still sit in the text, with their positions; the detached ones are left out. */
function locatedIn(all: readonly Suggestion[], file: string, locate: (s: Suggestion) => TextRange | "detached"): FileSuggestion[] {
  const found: FileSuggestion[] = [];
  for (const each of all) {
    if (each.file !== file) { continue; }
    const range = locate(each);
    if (range !== "detached") { found.push(toFileSuggestion(each, range)); }
  }
  return found;
}

/** A project's suggestion store, local or shared. */
interface ProjectSuggestionStore {
  list(file: string): Promise<FileSuggestion[]>;
  add(file: string, suggestions: readonly FileSuggestion[]): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
  /** Calls `listener` after the store changes, by this window or another; returns the stop. */
  onChange(listener: () => void): () => void;
  dispose(): void;
}

/** An unshared project's suggestions, read from and written to its comments.qmd. */
class FileSuggestionStore implements ProjectSuggestionStore {
  private readonly access: CommentsFileAccess;
  private readonly listeners = new Set<() => void>();
  private readonly stopWatching: () => void;

  constructor(private readonly folder: string, private readonly files: SuggestionFiles) {
    this.access = files.comments(folder);
    this.stopWatching = files.watch(folder, () => this.notify());
  }

  async list(file: string): Promise<FileSuggestion[]> {
    const doc = await loadCommentsDocument(this.access);
    if (!doc) { throw new Error(`${COMMENTS_PATH} is not a valid comments file. Fix the file to see suggestions.`); }
    const text = await this.files.textOf(this.folder, file);
    if (text === undefined) { return []; }
    return locatedIn(deriveSuggestions(doc), file, (each) => {
      const at = findSuggestion(each, text);
      return at === "detached" ? at : { start: toLfOffset(text, at.start), end: toLfOffset(text, at.end) };
    });
  }

  async add(file: string, suggestions: readonly FileSuggestion[]): Promise<void> {
    // The editor adds after its save flush, so the file's text is the one its offsets are in.
    const source = await this.files.textOf(this.folder, file);
    if (source === undefined) { throw new Error(`${file} does not exist in the project, so it cannot hold suggestions`); }
    const added = suggestions.map((each) => toSuggestion(each, file, deriveSuggestionAnchor(source, each.kind, toFileOffset(source, each.start), toFileOffset(source, each.end))));
    await updateCommentsDocument(this.access, (doc) => addSuggestions(removeSuggestions(doc, added.map((each) => each.id)), added));
    this.notify();
  }

  async remove(ids: readonly string[]): Promise<void> {
    await updateCommentsDocument(this.access, (doc) => removeSuggestions(doc, ids));
    this.notify();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    this.stopWatching();
    this.listeners.clear();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) { listener(); }
  }
}

/** A shared project's suggestions, live with every member. */
class SharedSuggestionStore implements ProjectSuggestionStore {
  constructor(private readonly shared: SharedProjectSuggestions) {}

  async list(file: string): Promise<FileSuggestion[]> {
    return locatedIn(this.shared.suggestions(), file, (each) => this.shared.locate(each));
  }

  // The live text is LF, so the editor's offsets are the share's.
  async add(file: string, suggestions: readonly FileSuggestion[]): Promise<void> {
    const added = suggestions.map((each) => toSuggestion(each, file, this.shared.anchor(file, each.kind, { start: each.start, end: each.end })));
    const present = new Set(this.shared.suggestions().map((each) => each.id));
    this.shared.remove(added.filter((each) => present.has(each.id)).map((each) => each.id));
    this.shared.add(added);
  }

  async remove(ids: readonly string[]): Promise<void> {
    this.shared.remove([...ids]);
  }

  onChange(listener: () => void): () => void {
    return this.shared.onChange(listener);
  }

  dispose(): void {}
}

/** The VS Code access to a local project's files. */
function vscodeSuggestionFiles(): SuggestionFiles {
  return {
    comments: (folder) => {
      const uri = createProjectFileUri(folder, COMMENTS_PATH);
      return {
        read: () => readTextFile(uri),
        write: async (text) => {
          await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
          await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
        },
      };
    },
    textOf: async (folder, file) => {
      const uri = createProjectFileUri(folder, file);
      const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
      return open ? open.getText() : readTextFile(uri);
    },
    watch: (folder, onChange) => {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(folder), COMMENTS_PATH));
      const subscriptions = [watcher.onDidChange(onChange), watcher.onDidCreate(onChange), watcher.onDidDelete(onChange)];
      return () => { subscriptions.forEach((each) => each.dispose()); watcher.dispose(); };
    },
  };
}

interface ProjectStore { key: string; store: ProjectSuggestionStore; stop: () => void }
interface Subscription { uri: vscode.Uri; listener: (suggestions: FileSuggestion[]) => void; generation: number; active: boolean }

/** One suggestion store per open project, over its share while one is connected and over comments.qmd otherwise. */
export class SuggestionsController implements SourceFileSuggestions, vscode.Disposable {
  private readonly stores = new Map<string, ProjectStore>();
  private readonly subscriptions = new Set<Subscription>();
  private readonly files: SuggestionFiles;
  private readonly sharedSuggestions: (share: CommentShare) => SharedProjectSuggestions;
  private readonly listening: vscode.Disposable[];

  constructor(private readonly deps: SuggestionsDeps) {
    this.files = deps.files ?? vscodeSuggestionFiles();
    this.sharedSuggestions = deps.sharedSuggestions ?? ((share) => createSharedProjectSuggestions(share.session));
    this.listening = [deps.projects.onDidChange(() => this.sync()), deps.shares.onDidChange(() => this.sync())];
    this.sync();
  }

  author(): string { return this.deps.author ?? DEFAULT_AUTHOR; }

  suggestionsFor(uri: vscode.Uri): EditorSuggestions {
    return {
      subscribe: (listener) => {
        const subscription: Subscription = { uri, listener, generation: 0, active: true };
        this.subscriptions.add(subscription);
        void this.deliver(subscription);
        return () => { subscription.active = false; this.subscriptions.delete(subscription); };
      },
      add: async (suggestions) => {
        if (suggestions.length === 0) { return; }
        const target = this.locate(uri);
        if (!target) { throw new Error("the file is not inside an open LabShelf project"); }
        await target.store.add(target.file, suggestions);
      },
      remove: async (ids) => {
        if (ids.length === 0) { return; }
        const target = this.locate(uri);
        if (!target) { throw new Error("the file is not inside an open LabShelf project"); }
        await target.store.remove(ids);
      },
    };
  }

  dispose(): void {
    this.subscriptions.clear();
    this.listening.forEach((each) => each.dispose());
    [...this.stores.keys()].forEach((folder) => this.drop(folder));
  }

  /** Gives a subscriber the suggestions of its file; a late answer that a newer one has overtaken is dropped. */
  private async deliver(subscription: Subscription): Promise<void> {
    const generation = ++subscription.generation;
    const target = this.locate(subscription.uri);
    const found = target ? await target.store.list(target.file).catch((error: unknown): FileSuggestion[] => {
      void this.deps.logger.error(SUGGESTIONS_LOG_MODULE, error, { action: "read suggestions", uri: subscription.uri.toString() });
      return [];
    }) : [];
    if (subscription.active && subscription.generation === generation) { subscription.listener(found); }
  }

  private notify(): void {
    for (const subscription of [...this.subscriptions]) { void this.deliver(subscription); }
  }

  /** The store a file belongs to and the file's POSIX path in its project; files under `.labshelf/` hold no suggestions. */
  private locate(uri: vscode.Uri): { file: string; store: ProjectSuggestionStore } | undefined {
    if (uri.scheme !== "file") { return undefined; }
    const { paths } = this.deps.projects;
    for (const [folder, { store }] of this.stores) {
      if (!isInside(paths, folder, uri.fsPath)) { continue; }
      const file = paths.relative(folder, uri.fsPath).split(paths.sep).join("/");
      return file.startsWith(".labshelf/") ? undefined : { file, store };
    }
    return undefined;
  }

  private sync(): void {
    reconcileProjects(this.deps, this.stores, (folder) => this.drop(folder), (folder, share, key) => {
      const store = share ? new SharedSuggestionStore(this.sharedSuggestions(share)) : new FileSuggestionStore(folder, this.files);
      this.stores.set(folder, { key, store, stop: store.onChange(() => this.notify()) });
    });
    this.notify();
  }

  private drop(folder: string): void {
    const entry = this.stores.get(folder);
    if (!entry) { return; }
    this.stores.delete(folder);
    entry.stop();
    entry.store.dispose();
  }
}

let sourceFileSuggestions: SourceFileSuggestions | undefined;

/** Set when the store starts and cleared when it is disposed; the LabShelf editor reads it for the file's suggestions. */
export function provideSourceFileSuggestions(port: SourceFileSuggestions | undefined): void { sourceFileSuggestions = port; }

export function currentSourceFileSuggestions(): SourceFileSuggestions | undefined { return sourceFileSuggestions; }
