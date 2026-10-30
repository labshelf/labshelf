// Tests the document sync: client pushes become WorkspaceEdits, their echo is swallowed, outside edits reach the clients, save and dirty follow the document.
import * as vscode from "vscode";

import { createDocumentSync } from "../../../src/writing/sourceEditor/documentSync";

interface Change { from: number; to: number; insert: string }
interface Update { clientID: string; changes: Change[] }
type Posted = { type: string; [key: string]: unknown };

const workspace = vscode.workspace as unknown as {
  _fireTextDocumentChange: (event: unknown) => void;
  _fireDocumentEvent: (kind: string, document: unknown) => void;
};

const applyChange = (text: string, change: Change): string => text.slice(0, change.from) + change.insert + text.slice(change.to);
const applyChanges = (text: string, changes: readonly Change[]): string =>
  [...changes].sort((a, b) => b.from - a.from).reduce(applyChange, text);

/** A TextDocument double with the lookups documentSync may use, and the events VS Code fires when its text changes. */
function fakeTextDocument(file: string, initial: string) {
  const state = { text: initial };
  const document = {
    uri: vscode.Uri.file(file),
    languageId: "latex",
    fileName: file,
    version: 1,
    isDirty: false,
    eol: 1,
    save: jest.fn(async () => { document.isDirty = false; return true; }),
    getText: () => state.text,
    get lineCount() { return state.text.split("\n").length; },
    offsetAt: (position: vscode.Position): number => {
      const lines = state.text.split("\n");
      return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
    },
    positionAt: (offset: number): vscode.Position => {
      const before = state.text.slice(0, offset).split("\n");
      return new vscode.Position(before.length - 1, before[before.length - 1]!.length);
    },
  };
  /** Applies a change the way VS Code does and fires onDidChangeTextDocument for it. */
  const change = (changes: Change[]) => {
    const contentChanges = changes.map((c) => ({
      range: new vscode.Range(document.positionAt(c.from), document.positionAt(c.to)),
      rangeOffset: c.from, rangeLength: c.to - c.from, text: c.insert,
    }));
    state.text = applyChanges(state.text, changes);
    document.version += 1;
    document.isDirty = true;
    workspace._fireTextDocumentChange({ document, contentChanges, reason: undefined });
  };
  return { document, change };
}

/** An authority double that keeps the text, a version counter and the updates since each version, without rebasing. */
function fakeAuthority(initial: string) {
  let text = initial;
  let version = 0;
  const history: Update[] = [];
  const authority = {
    get version() { return version; },
    text: () => text,
    receive: jest.fn((baseVersion: number, updates: readonly Update[]): Change[][] | undefined => {
      if (baseVersion > version || baseVersion < 0) return undefined;
      const accepted: Change[][] = [];
      for (const update of updates) {
        text = applyChanges(text, update.changes);
        version += 1;
        history.push(update);
        accepted.push(update.changes);
      }
      return accepted;
    }),
    external: jest.fn((changes: readonly Change[]): void => {
      text = applyChanges(text, changes);
      version += 1;
      history.push({ clientID: "host", changes: [...changes] });
    }),
    since: (since: number): Update[] => history.slice(since),
  };
  return authority;
}

/** A webview double that applies what the host posts the way a collab client does: others' updates and resyncs. */
function fakeClient(id: string, initial: string) {
  const client = { id, text: initial, posts: [] as Posted[] };
  const post = jest.fn((message: Posted) => {
    client.posts.push(message);
    if (message.type === "updates") {
      for (const update of message["updates"] as Update[]) {
        if (update.clientID !== id) client.text = applyChanges(client.text, update.changes);
      }
    } else if (message.type === "resync") {
      client.text = message["text"] as string;
    }
  });
  return { client, post };
}

const fakeLogger = () => ({ log: jest.fn(async () => {}), error: jest.fn(async () => {}) });

/** An applyEdit that applies the edit to the fake document, as VS Code does, firing the change event before it resolves. */
function applyingEdits(doc: ReturnType<typeof fakeTextDocument>) {
  return jest.fn(async (edit: vscode.WorkspaceEdit) => {
    const replacements = (edit as unknown as { replacements: Array<{ range: vscode.Range; text: string }> }).replacements;
    doc.change(replacements.map(({ range, text }) => ({
      from: doc.document.offsetAt(range.start), to: doc.document.offsetAt(range.end), insert: text,
    })));
    return true;
  });
}

const syncs: Array<{ dispose(): void }> = [];

function panel(doc: ReturnType<typeof fakeTextDocument>, authority: ReturnType<typeof fakeAuthority>, id: string, applyEdit = applyingEdits(doc)) {
  const { client, post } = fakeClient(id, doc.document.getText());
  const sync = createDocumentSync({
    document: doc.document, authority, applyEdit, post, logger: fakeLogger(),
  } as unknown as Parameters<typeof createDocumentSync>[0]);
  syncs.push(sync);
  const push = (...updates: Update[]) =>
    sync.receive({ type: "push", version: authority.version, updates } as never);
  return { sync, client, post, applyEdit, push };
}

const insert = (clientID: string, at: number, text: string): Update => ({ clientID, changes: [{ from: at, to: at, insert: text }] });
const postedUpdates = (posts: Posted[]): Update[] => posts.filter((p) => p.type === "updates").flatMap((p) => p["updates"] as Update[]);

afterEach(() => {
  while (syncs.length > 0) syncs.pop()!.dispose();
});

describe("documentSync push", () => {
  it("3.1b a push reaches the TextDocument through one WorkspaceEdit", async () => {
    const doc = fakeTextDocument("/p/main.tex", "hello\nworld");
    const { applyEdit, push } = panel(doc, fakeAuthority("hello\nworld"), "a");
    await push(insert("a", 8, "X"));
    expect(applyEdit).toHaveBeenCalledTimes(1);
    const replacements = (applyEdit.mock.calls[0]![0] as unknown as { replacements: Array<{ uri: vscode.Uri; range: vscode.Range; text: string }> }).replacements;
    expect(replacements).toHaveLength(1);
    expect(replacements[0]!.uri.toString()).toBe(doc.document.uri.toString());
    expect(replacements[0]!.range.start).toMatchObject({ line: 1, character: 2 });
    expect(replacements[0]!.text).toBe("X");
  });

  it("3.1b the TextDocument ends with the pushed text", async () => {
    const doc = fakeTextDocument("/p/main.tex", "hello\nworld");
    const { push } = panel(doc, fakeAuthority("hello\nworld"), "a");
    await push({ clientID: "a", changes: [{ from: 0, to: 5, insert: "howdy" }] });
    expect(doc.document.getText()).toBe("howdy\nworld");
  });

  it("3.1b a replacement spanning text is applied as a replace of that range", async () => {
    const doc = fakeTextDocument("/p/main.tex", "hello\nworld");
    const { applyEdit, push } = panel(doc, fakeAuthority("hello\nworld"), "a");
    await push({ clientID: "a", changes: [{ from: 3, to: 8, insert: "" }] });
    const replacements = (applyEdit.mock.calls[0]![0] as unknown as { replacements: Array<{ range: vscode.Range }> }).replacements;
    expect(replacements[0]!.range.start).toMatchObject({ line: 0, character: 3 });
    expect(replacements[0]!.range.end).toMatchObject({ line: 1, character: 2 });
  });

  it("3.1b the echo of an applied push is not recorded as an external change", async () => {
    const doc = fakeTextDocument("/p/main.tex", "hello");
    const authority = fakeAuthority("hello");
    const { push } = panel(doc, authority, "a");
    await push(insert("a", 5, "!"));
    expect(authority.external).not.toHaveBeenCalled();
  });

  it("3.1b the echo of an applied push is not sent back as a host update", async () => {
    const doc = fakeTextDocument("/p/main.tex", "hello");
    const { client, push } = panel(doc, fakeAuthority("hello"), "a");
    await push(insert("a", 5, "!"));
    expect(postedUpdates(client.posts).filter((update) => update.clientID !== "a")).toEqual([]);
    expect(client.text).toBe("hello");
  });

  it("3.1b the authority and the TextDocument agree after a push", async () => {
    const doc = fakeTextDocument("/p/main.tex", "hello");
    const authority = fakeAuthority("hello");
    const { push } = panel(doc, authority, "a");
    await push(insert("a", 0, ">> "));
    expect(authority.text()).toBe(doc.document.getText());
  });

  it("3.1b several updates in one push are applied one edit each, in order", async () => {
    const doc = fakeTextDocument("/p/main.tex", "hello");
    const authority = fakeAuthority("hello");
    const { applyEdit, push } = panel(doc, authority, "a");
    await push(insert("a", 0, "A"), insert("a", 1, "B"));
    expect(applyEdit).toHaveBeenCalledTimes(2);
    expect(doc.document.getText()).toBe("ABhello");
    expect(authority.external).not.toHaveBeenCalled();
  });

  it("3.1b a push on an unknown base version gets a resync and no edit", async () => {
    const doc = fakeTextDocument("/p/main.tex", "hello");
    const { client, applyEdit, sync } = panel(doc, fakeAuthority("hello"), "a");
    await sync.receive({ type: "push", version: 99, updates: [insert("a", 0, "X")] } as never);
    expect(applyEdit).not.toHaveBeenCalled();
    expect(client.posts).toContainEqual({ type: "resync", text: "hello", version: expect.any(Number) });
  });

  it("3.1b when applyEdit returns false the client gets a resync from the document", async () => {
    const doc = fakeTextDocument("/p/main.tex", "hello");
    const refusing = jest.fn(async (_edit: vscode.WorkspaceEdit) => false);
    const { client, push } = panel(doc, fakeAuthority("hello"), "a", refusing);
    await push(insert("a", 0, "X"));
    expect(client.posts).toContainEqual({ type: "resync", text: doc.document.getText(), version: expect.any(Number) });
    expect(client.text).toBe("hello");
  });
});

describe("documentSync outside edits", () => {
  it("3.1c an edit made elsewhere is recorded with authority.external", () => {
    const doc = fakeTextDocument("/p/main.tex", "hello");
    const authority = fakeAuthority("hello");
    panel(doc, authority, "a");
    doc.change([{ from: 5, to: 5, insert: "!" }]);
    expect(authority.external).toHaveBeenCalledTimes(1);
    expect(authority.external).toHaveBeenCalledWith([{ from: 5, to: 5, insert: "!" }]);
  });

  it("3.1c an edit made elsewhere reaches the webview as host updates", () => {
    const doc = fakeTextDocument("/p/main.tex", "hello");
    const { client, post } = panel(doc, fakeAuthority("hello"), "a");
    doc.change([{ from: 0, to: 0, insert: "> " }]);
    const message = post.mock.calls.map(([m]) => m).find((m) => m.type === "updates");
    expect(message?.["version"]).toEqual(expect.any(Number));
    expect(postedUpdates(client.posts).flatMap((update) => update.changes)).toEqual([{ from: 0, to: 0, insert: "> " }]);
    expect(client.text).toBe("> hello");
  });

  it("3.1c a replacement made elsewhere carries its range and text", () => {
    const doc = fakeTextDocument("/p/main.tex", "hello world");
    const { client } = panel(doc, fakeAuthority("hello world"), "a");
    doc.change([{ from: 6, to: 11, insert: "there" }]);
    expect(client.text).toBe("hello there");
  });

  it("3.1c an edit made elsewhere after a push is still delivered", async () => {
    const doc = fakeTextDocument("/p/main.tex", "hello");
    const authority = fakeAuthority("hello");
    const { client, push } = panel(doc, authority, "a");
    await push(insert("a", 5, "!"));
    doc.change([{ from: 0, to: 0, insert: "> " }]);
    expect(authority.external).toHaveBeenCalledTimes(1);
    expect(client.text).toBe("> hello");
  });

  it("3.1c a change to another document is ignored", () => {
    const doc = fakeTextDocument("/p/main.tex", "hello");
    const other = fakeTextDocument("/p/other.tex", "other");
    const authority = fakeAuthority("hello");
    const { post } = panel(doc, authority, "a");
    other.change([{ from: 0, to: 0, insert: "x" }]);
    expect(authority.external).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "updates" }));
  });

  it("3.1c nothing is posted or recorded after dispose", () => {
    const doc = fakeTextDocument("/p/main.tex", "hello");
    const authority = fakeAuthority("hello");
    const { sync, post } = panel(doc, authority, "a");
    sync.dispose();
    post.mockClear();
    doc.change([{ from: 0, to: 0, insert: "x" }]);
    expect(authority.external).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("3.1c two panels on one document stay equal after an edit made elsewhere", () => {
    const doc = fakeTextDocument("/p/main.tex", "hello\nworld");
    const authority = fakeAuthority("hello\nworld");
    const first = panel(doc, authority, "a");
    const second = panel(doc, authority, "b");
    doc.change([{ from: 6, to: 11, insert: "there" }]);
    expect(first.client.text).toBe(doc.document.getText());
    expect(second.client.text).toBe(doc.document.getText());
    expect(authority.text()).toBe(doc.document.getText());
  });

  it("3.1c two panels on one document stay equal after a push from one of them", async () => {
    const doc = fakeTextDocument("/p/main.tex", "hello\nworld");
    const authority = fakeAuthority("hello\nworld");
    const first = panel(doc, authority, "a");
    const second = panel(doc, authority, "b");
    first.client.text = "hello!\nworld";
    await first.push(insert("a", 5, "!"));
    expect(doc.document.getText()).toBe("hello!\nworld");
    expect(first.client.text).toBe(doc.document.getText());
    expect(second.client.text).toBe(doc.document.getText());
    expect(authority.text()).toBe(doc.document.getText());
  });
});

describe("documentSync save and dirty", () => {
  it("3.1d a save message saves the document", async () => {
    const doc = fakeTextDocument("/p/main.tex", "hello");
    const { sync } = panel(doc, fakeAuthority("hello"), "a");
    await sync.receive({ type: "save" } as never);
    expect(doc.document.save).toHaveBeenCalledTimes(1);
  });

  it("3.1d a push marks the editor dirty when the document became dirty", async () => {
    const doc = fakeTextDocument("/p/main.tex", "hello");
    const { client, push } = panel(doc, fakeAuthority("hello"), "a");
    await push(insert("a", 5, "!"));
    expect(client.posts.filter((p) => p.type === "dirty").pop()).toEqual({ type: "dirty", dirty: true });
  });

  it("3.1d an edit made elsewhere reports the document's dirty state", () => {
    const doc = fakeTextDocument("/p/main.tex", "hello");
    const { client } = panel(doc, fakeAuthority("hello"), "a");
    doc.change([{ from: 0, to: 0, insert: "x" }]);
    expect(client.posts.filter((p) => p.type === "dirty").pop()).toEqual({ type: "dirty", dirty: true });
  });

  it("3.1d saving the document clears dirty in the editor", async () => {
    const doc = fakeTextDocument("/p/main.tex", "hello");
    const { client, push } = panel(doc, fakeAuthority("hello"), "a");
    await push(insert("a", 5, "!"));
    doc.document.isDirty = false;
    workspace._fireDocumentEvent("save", doc.document);
    expect(client.posts.filter((p) => p.type === "dirty").pop()).toEqual({ type: "dirty", dirty: false });
  });

  it("3.1d saving another document does not report dirty", async () => {
    const doc = fakeTextDocument("/p/main.tex", "hello");
    const other = fakeTextDocument("/p/other.tex", "other");
    const { post } = panel(doc, fakeAuthority("hello"), "a");
    post.mockClear();
    workspace._fireDocumentEvent("save", other.document);
    expect(post).not.toHaveBeenCalled();
  });
});
