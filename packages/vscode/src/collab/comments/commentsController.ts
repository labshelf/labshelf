// Runs the LabShelf comment controller: one store and thread view per open project, over its share when one is connected.
import * as vscode from "vscode";

import {
  type Comment,
  type ILogger,
  type ProjectEntry,
  addThread,
  deriveAnchor,
  COMMENTS_PATH,
  deriveCommentThreads,
  updateCommentsDocument,
  loadCommentsDocument,
  findThread,
  addThreadReply,
  setThreadResolved,
  type CommentsDocument,
  type CommentsFileAccess,
  type CommentThread,
} from "@labshelf/core";
import type { WritingProjects } from "../../writing/index.js";
import {
  COMMENTS_LOG_MODULE,
  type CommentShare,
  type ProjectComments,
  projectFileUri,
  readTextFile,
} from "./projectComments.js";
import { SharedComments } from "./sharedComments.js";
import { editorCommentRange, sourceCommentRange } from "./sourceRanges.js";
import { ThreadView } from "./threadView.js";

/** An unshared project's threads, read from and written to its comments.json. */
class FileComments implements ProjectComments {
  private readonly uri: vscode.Uri;
  private readonly access: CommentsFileAccess;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly watcher: vscode.FileSystemWatcher;
  private cached: CommentThread[] = [];
  /** The invalid text last reported, so one broken file is reported once. */
  private reported: string | undefined;

  constructor(readonly folder: string, private readonly logger: ILogger) {
    this.uri = projectFileUri(folder, COMMENTS_PATH);
    this.access = {
      read: () => readTextFile(this.uri),
      write: async (text) => {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.uri, ".."));
        await vscode.workspace.fs.writeFile(this.uri, new TextEncoder().encode(text));
      },
    };
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(folder), COMMENTS_PATH));
    const reload = () => void this.load();
    this.watcher.onDidChange(reload);
    this.watcher.onDidCreate(reload);
    this.watcher.onDidDelete(reload);
    void this.load();
  }

  threads(): readonly CommentThread[] {
    return this.cached;
  }

  async textOf(file: string): Promise<string | undefined> {
    const uri = projectFileUri(this.folder, file);
    const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
    return open ? open.getText() : readTextFile(uri);
  }

  locate(thread: CommentThread, text: string) {
    return findThread(thread, text);
  }

  anchor(_file: string, text: string, range: { start: number; end: number }) {
    return deriveAnchor(text, range.start, range.end);
  }

  add(thread: CommentThread): Promise<void> {
    return this.edit((doc) => addThread(doc, thread));
  }

  reply(threadId: string, comment: CommentThread["comments"][number]): Promise<void> {
    return this.edit((doc) => addThreadReply(doc, threadId, comment));
  }

  setResolved(threadId: string, resolved: boolean): Promise<void> {
    return this.edit((doc) => setThreadResolved(doc, threadId, resolved));
  }

  dispose(): void {
    this.watcher.dispose();
    this.changeEmitter.dispose();
  }

  private async load(): Promise<void> {
    try {
      const text = await readTextFile(this.uri);
      const doc = await loadCommentsDocument({ ...this.access, read: async () => text });
      if (doc) { this.reported = undefined; } else { this.reportInvalid(text!); }
      this.cached = doc ? deriveCommentThreads(doc) : [];
      this.changeEmitter.fire();
    } catch (error) {
      void this.logger.error(COMMENTS_LOG_MODULE, error, { action: "read the comments", folder: this.folder });
    }
  }

  private reportInvalid(text: string): void {
    if (this.reported === text) { return; }
    this.reported = text;
    void this.logger.log("WARN", COMMENTS_LOG_MODULE, "comments.json is not valid; its threads are not shown and it is not written", { folder: this.folder, path: COMMENTS_PATH });
    void vscode.window.showWarningMessage(`LabShelf cannot read ${COMMENTS_PATH} in ${this.folder}. Fix the file to see and add comments.`);
  }

  private async edit(change: (doc: CommentsDocument) => CommentsDocument): Promise<void> {
    await updateCommentsDocument(this.access, change);
    await this.load();
  }
}

const RELOCATE_DELAY_MS = 300;

/** A review note to add as a thread; `file` is absolute and inside the project folder, `line` counts from 1. */
export interface SourceComment { projectFolder: string; file: string; line: number; quote: string; body: string }

export interface CommentsDeps {
  projects: Pick<WritingProjects, "list" | "onDidChange" | "paths">;
  shares: { list(): readonly CommentShare[]; readonly onDidChange: vscode.Event<void> };
  /** The author name of this user's comments, the one their presence shows. */
  userName: string;
  logger: ILogger;
}

interface ProjectView { key: string; view: ThreadView; subscription: vscode.Disposable }

const isOpenProject = (entry: ProjectEntry): entry is Extract<ProjectEntry, { kind: "ready" }> => entry.kind === "ready" && !entry.settings.trashed;

export class CommentsController implements vscode.Disposable {
  private readonly controller = vscode.comments.createCommentController("labshelf.comments", "LabShelf");
  private readonly views = new Map<string, ProjectView>();
  private readonly relocations = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly deps: CommentsDeps) {
    this.controller.options = { prompt: "Comment on the source", placeHolder: "Add a comment" };
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (document) => (this.locate(document.uri) ? [new vscode.Range(0, 0, Math.max(0, document.lineCount - 1), 0)] : []),
    };
    this.subscriptions = [
      deps.projects.onDidChange(() => this.sync()),
      deps.shares.onDidChange(() => this.sync()),
      vscode.workspace.onDidChangeTextDocument(({ document }) => this.scheduleRelocate(document.uri)),
    ];
    this.sync();
  }

  /** Replies to a thread, or adds the thread VS Code drafted from the gutter with its first comment. */
  async reply({ thread, text }: vscode.CommentReply): Promise<void> {
    const target = this.locate(thread.uri);
    if (!target) { throw new Error("the file is not inside an open LabShelf project"); }
    const id = target.view.idOf(thread);
    if (id) { await target.view.store.reply(id, this.comment(text)); return; }
    const source = await target.view.store.textOf(target.file);
    if (source === undefined) { throw new Error(`${target.file} is not a text file of the project`); }
    const range = thread.range ?? new vscode.Range(0, 0, 0, 0);
    const anchored = editorCommentRange(source, range.start, range.end);
    if (!anchored) { void vscode.window.showInformationMessage("Comment on a line that has text."); return; }
    const newId = await this.addThread(target.view, target.file, source, anchored, text);
    thread.dispose();
    await target.view.refresh(newId);
  }

  async setResolved(thread: vscode.CommentThread, resolved: boolean): Promise<void> {
    const target = this.locate(thread.uri);
    const id = target?.view.idOf(thread);
    if (!target || !id) { throw new Error("LabShelf does not hold this thread"); }
    await target.view.store.setResolved(id, resolved);
  }

  /** Adds a review note as a thread on the quote near the line, or on the whole line when the quote is not there. */
  async addSourceComment(request: SourceComment): Promise<void> {
    const target = this.locate(vscode.Uri.file(request.file));
    if (!target || target.folder !== request.projectFolder) { throw new Error(`${request.file} is not inside the open project ${request.projectFolder}`); }
    const source = await target.view.store.textOf(target.file);
    if (source === undefined) { throw new Error(`${target.file} is not a text file of the project`); }
    const anchored = sourceCommentRange(source, request.line, request.quote);
    if (!anchored) { throw new Error(`line ${request.line} of ${target.file} holds no text to comment on`); }
    const id = await this.addThread(target.view, target.file, source, anchored, request.body);
    await target.view.refresh(id);
    void this.deps.logger.log("INFO", COMMENTS_LOG_MODULE, "Added a review note as a comment", { folder: target.folder, file: target.file, line: request.line });
  }

  dispose(): void {
    this.relocations.forEach((timer) => clearTimeout(timer));
    this.subscriptions.forEach((subscription) => subscription.dispose());
    [...this.views.keys()].forEach((folder) => this.drop(folder));
    this.controller.dispose();
  }

  private comment(body: string): Comment {
    return { id: globalThis.crypto.randomUUID(), author: this.deps.userName, body, createdAt: new Date().toISOString() };
  }

  private async addThread(view: ThreadView, file: string, source: string, range: { start: number; end: number }, body: string): Promise<string> {
    const id = globalThis.crypto.randomUUID();
    await view.store.add({ id, file, anchor: view.store.anchor(file, source, range), comments: [this.comment(body)], resolved: false });
    return id;
  }

  /** The project view a file belongs to and the file's POSIX path in it; files under `.labshelf/` take no comments. */
  private locate(uri: vscode.Uri): { folder: string; file: string; view: ThreadView } | undefined {
    if (uri.scheme !== "file") { return undefined; }
    const { paths } = this.deps.projects;
    for (const [folder, { view }] of this.views) {
      const relative = paths.relative(folder, uri.fsPath);
      if (!relative || relative.startsWith("..") || paths.isAbsolute(relative)) { continue; }
      const file = relative.split(paths.sep).join("/");
      return file.startsWith(".labshelf/") ? undefined : { folder, file, view };
    }
    return undefined;
  }

  private sync(): void {
    const open = this.deps.projects.list().filter(isOpenProject);
    for (const folder of this.views.keys()) {
      if (!open.some((project) => project.folder === folder)) { this.drop(folder); }
    }
    for (const { folder } of open) {
      const share = this.deps.shares.list().find((candidate) => candidate.folder === folder);
      const key = share ? `share:${share.shareId}` : "file";
      if (this.views.get(folder)?.key === key) { continue; }
      this.drop(folder);
      const store: ProjectComments = share ? new SharedComments(share) : new FileComments(folder, this.deps.logger);
      const view = new ThreadView(this.controller, store, this.deps.logger);
      this.views.set(folder, { key, view, subscription: store.onDidChange(() => void view.refresh()) });
      void view.refresh();
    }
  }

  private drop(folder: string): void {
    const entry = this.views.get(folder);
    if (!entry) { return; }
    this.views.delete(folder);
    entry.subscription.dispose();
    entry.view.dispose();
    entry.view.store.dispose();
  }

  private scheduleRelocate(uri: vscode.Uri): void {
    const target = this.locate(uri);
    if (!target) { return; }
    clearTimeout(this.relocations.get(target.folder));
    this.relocations.set(target.folder, setTimeout(() => { this.relocations.delete(target.folder); void target.view.refresh(); }, RELOCATE_DELAY_MS));
  }
}
