// Tests the comment bridge of the LabShelf source editor: the file's threads posted to the webview, adding a thread through the comment manager's port, and opening the Comments view.
import * as vscode from "vscode";

import { currentSourceFileComments, provideSourceFileComments, type SourceFileComments } from "../../src/collab/comments";
import { createSourceBridges } from "../../src/writing/sourceEditor/bridges";

type Range = { id: string; from: number; to: number };
type Message = { type: "comments"; ranges: Range[] };

const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
const fileUri = vscode.Uri.file("/proj/sections/intro.tex");

// A fake comment manager: subscribe answers at once with the current ranges and again on emit().
function fakePort(initial: Range[] = []) {
  let current = initial;
  const listeners = new Set<(ranges: Range[]) => void>();
  const disposables: { dispose: jest.Mock }[] = [];
  const port = {
    subscribe: jest.fn((_uri: vscode.Uri, listener: (ranges: Range[]) => void) => {
      listeners.add(listener);
      listener(current);
      const disposable = { dispose: jest.fn(() => { listeners.delete(listener); }) };
      disposables.push(disposable);
      return disposable;
    }),
    add: jest.fn(async (_uri: vscode.Uri, _range: { from: number; to: number }, _text: string) => {}),
  };
  return {
    port: port as unknown as SourceFileComments & typeof port,
    disposables,
    emit(ranges: Range[]) { current = ranges; for (const listener of [...listeners]) listener(ranges); },
    listenerCount: () => listeners.size,
  };
}

function create(comments?: SourceFileComments) {
  return createSourceBridges({
    uri: fileUri, projectRoot: vscode.Uri.file("/proj"),
    library: {} as never, notes: {} as never, openNotes: jest.fn(), logger: logger as never,
    comments,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  provideSourceFileComments(undefined);
});

describe("watchComments", () => {
  it("4.3a posts the file's threads at once as a comments message", () => {
    const fake = fakePort([{ id: "t1", from: 4, to: 12 }, { id: "t2", from: 30, to: 31 }]);
    const post = jest.fn();
    create(fake.port).watchComments(post);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ type: "comments", ranges: [{ id: "t1", from: 4, to: 12 }, { id: "t2", from: 30, to: 31 }] });
  });

  it("4.3a subscribes to the bridge's own file", () => {
    const fake = fakePort();
    create(fake.port).watchComments(jest.fn());
    expect(fake.port.subscribe).toHaveBeenCalledTimes(1);
    expect((fake.port.subscribe.mock.calls[0] as unknown as [vscode.Uri])[0].fsPath).toBe(fileUri.fsPath);
  });

  it("4.3a posts an empty list for a file outside every open project", () => {
    const post = jest.fn();
    create(fakePort([]).port).watchComments(post);
    expect(post).toHaveBeenCalledWith({ type: "comments", ranges: [] });
  });

  it("4.3a posts again, with the new ranges, when a thread is added elsewhere", () => {
    const fake = fakePort([{ id: "t1", from: 4, to: 12 }]);
    const post = jest.fn();
    create(fake.port).watchComments(post);
    fake.emit([{ id: "t1", from: 4, to: 12 }, { id: "t3", from: 50, to: 60 }]);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenLastCalledWith({ type: "comments", ranges: [{ id: "t1", from: 4, to: 12 }, { id: "t3", from: 50, to: 60 }] });
  });

  it("4.3a posts again when a thread is relocated or resolved", () => {
    const fake = fakePort([{ id: "t1", from: 4, to: 12 }]);
    const post = jest.fn();
    create(fake.port).watchComments(post);
    fake.emit([{ id: "t1", from: 9, to: 17 }]);
    fake.emit([]);
    expect((post.mock.calls as Message[][]).map(([message]) => message.ranges)).toEqual([
      [{ id: "t1", from: 4, to: 12 }], [{ id: "t1", from: 9, to: 17 }], [],
    ]);
  });

  it("4.3a passes the port's LF offsets through unchanged, as the offsets of a CRLF file's LF text", () => {
    // "line one\r\nline two" has the LF text "line one\nline two": "line two" is at 9..17 there, not 10..18.
    const fake = fakePort([{ id: "t1", from: 9, to: 17 }]);
    const post = jest.fn();
    create(fake.port).watchComments(post);
    expect(post).toHaveBeenCalledWith({ type: "comments", ranges: [{ id: "t1", from: 9, to: 17 }] });
  });

  it("4.3a disposing the result stops the subscription, so later updates post nothing", () => {
    const fake = fakePort();
    const post = jest.fn();
    const watcher = create(fake.port).watchComments(post);
    watcher.dispose();
    expect(fake.disposables[0].dispose).toHaveBeenCalledTimes(1);
    fake.emit([{ id: "t9", from: 1, to: 2 }]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("4.3b without a port, watchComments posts nothing and still returns a disposable", () => {
    const post = jest.fn();
    const watcher = create(undefined).watchComments(post);
    expect(post).not.toHaveBeenCalled();
    expect(() => watcher.dispose()).not.toThrow();
  });
});

describe("addComment", () => {
  it("4.3b creates the thread through the port with the file's uri, the range and the text", async () => {
    const fake = fakePort();
    await create(fake.port).handle("addComment", { from: 4, to: 12, text: "why this baseline?" });
    expect(fake.port.add).toHaveBeenCalledTimes(1);
    const [uri, range, text] = fake.port.add.mock.calls[0] as unknown as [vscode.Uri, { from: number; to: number }, string];
    expect(uri.fsPath).toBe(fileUri.fsPath);
    expect(range).toEqual({ from: 4, to: 12 });
    expect(text).toBe("why this baseline?");
  });

  it("4.3b rejects when the port fails to add", async () => {
    const fake = fakePort();
    fake.port.add.mockRejectedValueOnce(new Error("no open project"));
    await expect(create(fake.port).handle("addComment", { from: 0, to: 3, text: "x" })).rejects.toThrow("no open project");
  });

  it("4.3b without a port it is refused with 'comments work in the desktop app'", async () => {
    await expect(create(undefined).handle("addComment", { from: 4, to: 12, text: "hi" })).rejects.toThrow("comments work in the desktop app");
  });
});

describe("openComments", () => {
  it("4.3b focuses VS Code's Comments view", async () => {
    await create(fakePort().port).handle("openComments", {});
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("workbench.panel.comments.focus");
  });
});

describe("the comment port registry", () => {
  it("4.3a has no port until the controller provides one", () => {
    expect(currentSourceFileComments()).toBeUndefined();
  });

  it("4.3a answers the provided port, and undefined again after it is withdrawn", () => {
    const { port } = fakePort();
    provideSourceFileComments(port);
    expect(currentSourceFileComments()).toBe(port);
    provideSourceFileComments(undefined);
    expect(currentSourceFileComments()).toBeUndefined();
  });

  it("4.3a a later provide replaces the earlier port", () => {
    const first = fakePort().port;
    const second = fakePort().port;
    provideSourceFileComments(first);
    provideSourceFileComments(second);
    expect(currentSourceFileComments()).toBe(second);
  });
});
