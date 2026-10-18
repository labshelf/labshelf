// Keeps the comment threads of a shared project in its index doc's comments map, and writes comments.json from the map.
// CONTRACT: documents/contracts/collaboration.md#comments
import * as vscode from "vscode";

import {
  addLiveThread, COMMENTS_PATH, fileText, indexComments, indexFiles, liveAnchorFor, liveThreads, locateThread, renderCommentsFile,
  replyToLiveThread, setLiveThreadResolved, type Comment, type CommentThread, type ILogger, type TextRange,
} from "@labshelf/core";
import { COMMENTS_LOG_MODULE, projectFileUri, readTextFile, type CommentShare, type ProjectComments } from "./projectComments.js";

const WRITE_DELAY_MS = 500;

/** A shared project's threads, live with every member; the file follows the map. */
export class SharedComments implements ProjectComments {
  readonly folder: string;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly fileUri: vscode.Uri;
  private writeTimer: ReturnType<typeof setTimeout> | undefined;
  private writing: Promise<void> = Promise.resolve();
  /** True after an invalid comments.json was reported, until a write succeeds. */
  private reported = false;
  private readonly onMap = () => { this.changeEmitter.fire(); this.scheduleWrite(); };

  constructor(private readonly share: CommentShare, private readonly logger: ILogger) {
    this.folder = share.folder;
    this.fileUri = projectFileUri(share.folder, COMMENTS_PATH);
    indexComments(share.session.index).observeDeep(this.onMap);
    // A member that joined or was offline gets the file of the threads it received.
    this.scheduleWrite();
  }

  threads(): readonly CommentThread[] {
    return liveThreads(this.share.session.index);
  }

  async textOf(file: string): Promise<string | undefined> {
    return indexFiles(this.share.session.index).get(file)?.kind === "text" ? this.yText(file).toString() : undefined;
  }

  locate(thread: CommentThread, text: string) {
    return locateThread(thread, text, this.yText(thread.file));
  }

  anchor(file: string, _text: string, range: TextRange) {
    return liveAnchorFor(this.yText(file), range.start, range.end);
  }

  async add(thread: CommentThread): Promise<void> {
    if (!addLiveThread(this.share.session.index, thread)) { throw new Error(`the share already holds a thread with id ${thread.id}`); }
  }

  async reply(threadId: string, comment: Comment): Promise<void> {
    if (!replyToLiveThread(this.share.session.index, threadId, comment)) { throw new Error(`the share holds no thread ${threadId}`); }
  }

  async setResolved(threadId: string, resolved: boolean): Promise<void> {
    if (!setLiveThreadResolved(this.share.session.index, threadId, resolved)) { throw new Error(`the share holds no thread ${threadId}`); }
  }

  /** Writes a pending change before it lets go of the map. */
  dispose(): void {
    indexComments(this.share.session.index).unobserveDeep(this.onMap);
    if (this.writeTimer) { clearTimeout(this.writeTimer); this.writeTimer = undefined; void this.write(); }
    this.changeEmitter.dispose();
  }

  private yText(file: string) {
    return fileText(this.share.session.openDoc(file));
  }

  private scheduleWrite(): void {
    if (this.writeTimer) { clearTimeout(this.writeTimer); }
    this.writeTimer = setTimeout(() => { this.writeTimer = undefined; void this.write(); }, WRITE_DELAY_MS);
  }

  // Writes run one after another, so an older render never lands after a newer one.
  private write(): Promise<void> {
    this.writing = this.writing.then(() => this.writeNow()).catch((error: unknown) => {
      void this.logger.error(COMMENTS_LOG_MODULE, error, { action: "write comments.json", folder: this.folder, shareId: this.share.shareId });
    });
    return this.writing;
  }

  private async writeNow(): Promise<void> {
    const existing = await readTextFile(this.fileUri);
    const rendered = renderCommentsFile(this.share.session.index, existing);
    if (rendered === undefined) { this.reportInvalid(); return; }
    this.reported = false;
    if (rendered === existing) { return; }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.fileUri, ".."));
    await vscode.workspace.fs.writeFile(this.fileUri, new TextEncoder().encode(rendered));
  }

  private reportInvalid(): void {
    if (this.reported) { return; }
    this.reported = true;
    void this.logger.log("WARN", COMMENTS_LOG_MODULE, "comments.json is not valid, so the shared threads are not written to it", { folder: this.folder, shareId: this.share.shareId });
    void vscode.window.showWarningMessage(`LabShelf does not overwrite ${COMMENTS_PATH} in ${this.folder}: the file is not valid. Fix or delete it to save the shared comments there.`);
  }
}

