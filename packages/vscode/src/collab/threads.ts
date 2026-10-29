// Shows a project's comment threads as VS Code comment threads on their source text: where the threads live and the thread view.
import * as vscode from "vscode";

import { bodyToDoc, derivePosition, type Comment, type CommentAnchor, type CommentThread, type ILogger, type ShareSession, type TextRange } from "@labshelf/core";
import { disposeAll } from "../disposables/index.js";

export const COMMENTS_LOG_MODULE = "comments";

/** The part of a connected share the shared comments use; the share connection satisfies it. */
export interface CommentShare {
  readonly shareId: string;
  /** The project folder, absolute. */
  readonly folder: string;
  readonly session: Pick<ShareSession, "index" | "openDoc">;
}

export interface ProjectComments extends vscode.Disposable {
  /** The project folder, absolute. */
  readonly folder: string;
  /** Fires after the threads changed, here or elsewhere. */
  readonly onDidChange: vscode.Event<void>;
  /** The valid threads, in the order every member sees. */
  threads(): readonly CommentThread[];
  /** The text anchors of `file` are in; undefined when the project has no such text file. */
  textOf(file: string): Promise<string | undefined>;
  /** Where the thread sits in `text`, the current result of `textOf(thread.file)`. */
  locate(thread: CommentThread, text: string): TextRange | "detached";
  anchor(file: string, text: string, range: TextRange): CommentAnchor;
  add(thread: CommentThread): Promise<void>;
  reply(threadId: string, comment: Comment): Promise<void>;
  setResolved(threadId: string, resolved: boolean): Promise<void>;
}

/** The URI of a file named by its POSIX path inside the project folder. */
export function createProjectFileUri(folder: string, file: string): vscode.Uri {
  return vscode.Uri.joinPath(vscode.Uri.file(folder), ...file.split("/"));
}

/** The file's text, or undefined when there is none. */
export async function readTextFile(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") { return undefined; }
    throw error;
  }
}

const OPEN_THREAD_CONTEXT = "labshelf.thread.open";
const RESOLVED_THREAD_CONTEXT = "labshelf.thread.resolved";

const DETACHED_QUOTE_LENGTH = 40;

type BodyNode = ReturnType<typeof bodyToDoc>;
/** Renders TeX as a markdown image; throws when the TeX does not parse. */
type MathImage = (tex: string, display: boolean) => string;

const hasMath = (doc: BodyNode): boolean => {
  let found = false;
  doc.descendants((node) => {
    if (node.type.name === "math_inline" || node.type.name === "math_display") { found = true; }
    return !found;
  });
  return found;
};

/** The math renderer of the LaTeX hover, loaded only when a body has math; undefined when it cannot be loaded. */
async function loadMathImage(): Promise<MathImage | undefined> {
  try {
    return (await import("../latex/index.js")).createThemedMathMarkdown;
  } catch {
    return undefined;
  }
}

function startParagraph(markdown: vscode.MarkdownString): void {
  if (markdown.value !== "") { markdown.appendMarkdown("\n\n"); }
}

function appendMath(markdown: vscode.MarkdownString, tex: string, display: boolean, math: MathImage | undefined): void {
  try {
    if (!math) { throw new Error("math is not available"); }
    markdown.appendMarkdown(math(tex, display));
  } catch {
    // A TeX error shows the source the writer typed.
    markdown.appendText(`$${tex}$`);
  }
}

function appendInline(markdown: vscode.MarkdownString, block: BodyNode, math: MathImage | undefined): void {
  block.forEach((node) => {
    switch (node.type.name) {
      case "text": markdown.appendText(node.text ?? ""); break;
      case "hard_break": markdown.appendText("\n"); break;
      case "math_inline": appendMath(markdown, node.attrs.tex as string, false, math); break;
      case "citation": markdown.appendText((node.attrs.raw as string | null) ?? (node.attrs.keys as string[]).map((key) => `@${key}`).join("; ")); break;
      case "image": markdown.appendText((node.attrs.alt as string) || (node.attrs.src as string)); break;
      default: break;
    }
  });
}

function appendCode(markdown: vscode.MarkdownString, code: string, language: string | null): void {
  const body = code.replace(/\r?\n$/, "");
  // TRAP: a fence inside the code would end the block and leave the rest as markdown.
  if (body.includes("```")) { markdown.appendText(body); return; }
  markdown.appendCodeblock(body, (language ?? "").replace(/[^\w+#.-]/g, ""));
}

function appendList(markdown: vscode.MarkdownString, list: BodyNode, math: MathImage | undefined): void {
  const ordered = list.type.name === "ordered_list";
  list.forEach((item, _offset, index) => {
    const marker = item.type.name === "task_item"
      ? (item.attrs.checked ? "[x] " : "[ ] ")
      : ordered ? `${(list.attrs.order as number) + index}. ` : "- ";
    item.forEach((child, _childOffset, childIndex) => appendBlock(markdown, child, math, childIndex === 0 ? marker : ""));
  });
}

function appendBlock(markdown: vscode.MarkdownString, block: BodyNode, math: MathImage | undefined, prefix = ""): void {
  switch (block.type.name) {
    case "paragraph":
    case "heading":
      startParagraph(markdown);
      markdown.appendText(prefix);
      appendInline(markdown, block, math);
      break;
    case "bullet_list":
    case "ordered_list": appendList(markdown, block, math); break;
    case "math_display": startParagraph(markdown); appendMath(markdown, block.attrs.tex as string, true, math); break;
    case "code_cell": startParagraph(markdown); appendCode(markdown, block.attrs.code as string, block.attrs.lang as string | null); break;
    case "raw_block": startParagraph(markdown); markdown.appendText(block.attrs.text as string); break;
    default: break;
  }
}

/** The comments of a thread as VS Code shows them; their bodies are LabShelf Markdown with the math rendered. */
async function commentsOf(thread: CommentThread): Promise<vscode.Comment[]> {
  const docs = thread.comments.map((comment) => bodyToDoc(comment.body));
  const math = docs.some(hasMath) ? await loadMathImage() : undefined;
  return thread.comments.map((comment, index) => {
    // TRAP: bodies come from collaborators, so they are shown as escaped text, never as trusted markdown.
    const body = new vscode.MarkdownString();
    docs[index]!.forEach((block) => appendBlock(body, block, math));
    return {
      body,
      mode: vscode.CommentMode.Preview,
      author: { name: comment.author },
      timestamp: new Date(comment.createdAt),
    };
  });
}

function detachedLabel(thread: CommentThread): string {
  const { quote } = thread.anchor;
  return `Detached · “${quote.length > DETACHED_QUOTE_LENGTH ? `${quote.slice(0, DETACHED_QUOTE_LENGTH)}…` : quote}”`;
}

export class ThreadView implements vscode.Disposable {
  private readonly shown = new Map<string, vscode.CommentThread>();
  private rendering: Promise<void> = Promise.resolve();

  constructor(private readonly controller: vscode.CommentController, readonly store: ProjectComments, private readonly logger: ILogger) {}

  /** The id of a thread this view shows. */
  idOf(thread: vscode.CommentThread): string | undefined {
    return [...this.shown].find(([, shown]) => shown === thread)?.[0];
  }

  /** Shows the store's threads again, one render after another; `expand` opens that thread. */
  refresh(expand?: string): Promise<void> {
    this.rendering = this.rendering.then(() => this.render(expand)).catch((error: unknown) => {
      void this.logger.error(COMMENTS_LOG_MODULE, error, { action: "show the comments", folder: this.store.folder });
    });
    return this.rendering;
  }

  dispose(): void {
    disposeAll([...this.shown.values()]);
    this.shown.clear();
  }

  private async render(expand: string | undefined): Promise<void> {
    const threads = this.store.threads();
    const texts = new Map<string, string | undefined>();
    for (const file of new Set(threads.map((thread) => thread.file))) { texts.set(file, await this.store.textOf(file)); }
    const kept = new Set<string>();
    for (const thread of threads) {
      kept.add(thread.id);
      this.show(thread, texts.get(thread.file), thread.id === expand, await commentsOf(thread));
    }
    for (const [id, shown] of this.shown) {
      if (!kept.has(id)) { shown.dispose(); this.shown.delete(id); }
    }
  }

  private show(thread: CommentThread, text: string | undefined, expand: boolean, comments: vscode.Comment[]): void {
    const located = text === undefined ? "detached" : this.store.locate(thread, text);
    const range = located === "detached" || text === undefined
      ? new vscode.Range(0, 0, 0, 0)
      : new vscode.Range(...rangeArgs(text, located.start, located.end));
    let shown = this.shown.get(thread.id);
    const wasResolved = shown?.state === vscode.CommentThreadState.Resolved;
    if (!shown) {
      shown = this.controller.createCommentThread(createProjectFileUri(this.store.folder, thread.file), range, comments);
      shown.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
      this.shown.set(thread.id, shown);
    } else {
      shown.range = range;
      shown.comments = comments;
    }
    shown.canReply = true;
    // TRAP: the typings forbid undefined, but only undefined clears a label once the thread is found again.
    (shown as { label: string | undefined }).label = located === "detached" ? detachedLabel(thread) : undefined;
    shown.state = thread.resolved ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
    shown.contextValue = thread.resolved ? RESOLVED_THREAD_CONTEXT : OPEN_THREAD_CONTEXT;
    if (thread.resolved && !wasResolved) { shown.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed; }
    if (expand) { shown.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded; }
  }
}

function rangeArgs(text: string, start: number, end: number): [number, number, number, number] {
  const from = derivePosition(text, start);
  const to = derivePosition(text, end);
  return [from.line, from.character, to.line, to.character];
}
