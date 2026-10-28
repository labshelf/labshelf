// Pins how the project's comment threads show as VS Code comment threads: the file URI, the text read, and each thread's range, label, state and expansion.
import * as vscode from "vscode";
import type { CommentThread, ILogger } from "@labshelf/core";
import { createProjectFileUri, readTextFile, ThreadView, type ProjectComments } from "../../src/collab/threads";

// The shared vscode mock has no comment API or FileSystemError; the view needs only these values.
jest.mock("vscode", () => {
  const actual = jest.requireActual("vscode");
  class FileSystemError extends Error {
    constructor(readonly code: string) { super(code); }
  }
  return {
    ...actual,
    FileSystemError,
    CommentMode: { Editing: 0, Preview: 1 },
    CommentThreadState: { Unresolved: 0, Resolved: 1 },
    CommentThreadCollapsibleState: { Collapsed: 0, Expanded: 1 },
  };
});

const text = "We compare against a strong baseline.\nSecond line.";

const threadOf = (id: string, over: Partial<CommentThread> = {}): CommentThread => ({
  id, file: "sections/intro.tex", anchor: { quote: "a strong baseline", prefix: "", suffix: "" },
  comments: [{ id: "c1", author: "Ana", body: "**why?**", createdAt: "2026-10-16T09:12:00.000Z" }], resolved: false, ...over,
});

function setup(threads: CommentThread[], locate: ProjectComments["locate"], fileText: string | null = text) {
  const created: Record<string, any>[] = [];
  const controller = {
    createCommentThread: jest.fn((uri: vscode.Uri, range: vscode.Range, comments: vscode.Comment[]) => {
      const shown = { uri, range, comments, dispose: jest.fn() };
      created.push(shown);
      return shown;
    }),
  };
  const store = { folder: "/project", threads: () => threads, textOf: jest.fn(async () => fileText ?? undefined), locate } as unknown as ProjectComments;
  const logger: ILogger = { log: async () => undefined, error: jest.fn(async () => undefined) };
  const view = new ThreadView(controller as unknown as vscode.CommentController, store, logger);
  return { view, created, controller, logger };
}

describe("createProjectFileUri", () => {
  it("joins the POSIX path of a project file onto the project folder", () => {
    expect(createProjectFileUri("/project", "sections/intro.tex").fsPath).toBe("/project/sections/intro.tex");
  });
});

describe("readTextFile", () => {
  const readFile = vscode.workspace.fs.readFile as jest.Mock;

  it("decodes the file's bytes", async () => {
    readFile.mockResolvedValueOnce(new TextEncoder().encode("héllo"));
    await expect(readTextFile(vscode.Uri.file("/project/a.tex"))).resolves.toBe("héllo");
  });

  it("resolves to undefined for a missing file and rethrows any other failure", async () => {
    readFile.mockRejectedValueOnce(new (vscode.FileSystemError as unknown as new (code: string) => Error)("FileNotFound"));
    await expect(readTextFile(vscode.Uri.file("/project/a.tex"))).resolves.toBeUndefined();
    readFile.mockRejectedValueOnce(new Error("disk failed"));
    await expect(readTextFile(vscode.Uri.file("/project/a.tex"))).rejects.toThrow("disk failed");
  });
});

describe("ThreadView", () => {
  it("shows a located thread on its text, with its comments as escaped text", async () => {
    const { view, created } = setup([threadOf("t1")], () => ({ start: 11, end: 28 }));
    await view.refresh();

    const shown = created[0]!;
    expect(shown.uri.fsPath).toBe("/project/sections/intro.tex");
    expect(shown.range).toMatchObject({ start: { line: 0, character: 11 }, end: { line: 0, character: 28 } });
    expect(shown.comments[0]).toMatchObject({ author: { name: "Ana" }, mode: vscode.CommentMode.Preview });
    expect(shown.comments[0].body.value).toBe("**why?**");
    expect(shown.label).toBeUndefined();
    expect(shown.state).toBe(vscode.CommentThreadState.Unresolved);
    expect(shown.contextValue).toBe("labshelf.thread.open");
    expect(shown.canReply).toBe(true);
    expect(view.idOf(shown as unknown as vscode.CommentThread)).toBe("t1");
  });

  it("shows a thread whose text is gone at the file start, labelled with a shortened quote", async () => {
    const quote = "q".repeat(60);
    const { view, created } = setup([threadOf("t1", { anchor: { quote, prefix: "", suffix: "" } })], () => "detached");
    await view.refresh();

    expect(created[0]!.range).toMatchObject({ start: { line: 0, character: 0 }, end: { line: 0, character: 0 } });
    expect(created[0]!.label).toBe(`Detached · “${"q".repeat(40)}…”`);
  });

  it("treats a thread of a missing file as detached", async () => {
    const { view, created } = setup([threadOf("t1")], () => ({ start: 0, end: 1 }), null);
    await view.refresh();
    expect(created[0]!.label).toMatch(/^Detached/);
  });

  it("marks a resolved thread, expands the asked one, and updates it in place on the next refresh", async () => {
    const threads = [threadOf("t1", { resolved: true }), threadOf("t2")];
    const { view, created, controller } = setup(threads, () => ({ start: 0, end: 2 }));
    await view.refresh("t2");

    expect(created[0]!.state).toBe(vscode.CommentThreadState.Resolved);
    expect(created[0]!.contextValue).toBe("labshelf.thread.resolved");
    expect(created[0]!.collapsibleState).toBe(vscode.CommentThreadCollapsibleState.Collapsed);
    expect(created[1]!.collapsibleState).toBe(vscode.CommentThreadCollapsibleState.Expanded);

    threads[1]!.comments.push({ id: "c2", author: "Ben", body: "reply", createdAt: "2026-10-16T10:00:00.000Z" });
    await view.refresh();
    expect(controller.createCommentThread).toHaveBeenCalledTimes(2);
    expect(created[1]!.comments).toHaveLength(2);
  });

  it("disposes the threads that are gone and all of them on dispose", async () => {
    const threads = [threadOf("t1"), threadOf("t2")];
    const { view, created } = setup(threads, () => ({ start: 0, end: 2 }));
    await view.refresh();
    threads.pop();
    await view.refresh();
    expect(created[1]!.dispose).toHaveBeenCalledTimes(1);
    expect(created[0]!.dispose).not.toHaveBeenCalled();

    view.dispose();
    expect(created[0]!.dispose).toHaveBeenCalledTimes(1);
  });

  it("logs a failed render and stays usable", async () => {
    const { view, logger, created } = setup([threadOf("t1")], () => ({ start: 0, end: 2 }));
    const failing = view as unknown as { store: ProjectComments };
    (failing.store.textOf as jest.Mock).mockRejectedValueOnce(new Error("read failed"));
    await view.refresh();
    expect(logger.error).toHaveBeenCalledWith("comments", expect.any(Error), expect.objectContaining({ folder: "/project" }));
    await view.refresh();
    expect(created).toHaveLength(1);
  });
});
