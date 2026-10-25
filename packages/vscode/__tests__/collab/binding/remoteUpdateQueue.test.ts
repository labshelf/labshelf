/** Pins the per-document queue of shared edits: one applyChange at a time, recomputed and retried when the user typed meanwhile. */
import * as vscode from "vscode";
// This package does not depend on yjs; the test uses core's copy, the one core's binding imports.
import * as Y from "yjs";
import type { ILogger } from "@labshelf/core";
import { bindDocument, RemoteEditQueue } from "../../../src/collab/binding";

interface Replacement { range: { start: vscode.Position; end: vscode.Position }; text: string }

function recordingLogger() {
  const warnings: string[] = [];
  const errors: unknown[] = [];
  const logger: ILogger = {
    log: async (level, _module, message) => { if (level === "WARN") { warnings.push(message); } },
    error: async (_module, error) => { errors.push(error); },
  };
  return { logger, warnings, errors };
}

function fakeDocument(initial: string) {
  const document = {
    uri: vscode.Uri.file("/project/main.tex"),
    text: initial,
    version: 1,
    isClosed: false,
    getText: () => document.text,
    offsetAt: (position: vscode.Position) => {
      const lines = document.text.split("\n");
      return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
    },
    positionAt: (offset: number) => {
      const before = document.text.slice(0, offset).split("\n");
      return new vscode.Position(before.length - 1, before[before.length - 1]!.length);
    },
    /** Changes the text and reports it, as VS Code does for typing and for an applied edit. */
    change(rangeOffset: number, rangeLength: number, text: string) {
      document.text = document.text.slice(0, rangeOffset) + text + document.text.slice(rangeOffset + rangeLength);
      document.version += 1;
      (vscode.workspace as unknown as { _fireTextDocumentChange(event: unknown): void })._fireTextDocumentChange({
        document, contentChanges: [{ rangeOffset, rangeLength, text }],
      });
    },
  };
  return document;
}

type FakeDocument = ReturnType<typeof fakeDocument>;

/** applyChange as VS Code runs it: refused when the version moved while the edit was in flight. */
function editorApplies(document: FakeDocument, whileInFlight: () => void = () => {}) {
  let running = 0;
  const stats = { calls: 0, maxConcurrent: 0 };
  (vscode.workspace.applyEdit as jest.Mock).mockImplementation(async (edit: { replacements: Replacement[] }) => {
    stats.calls += 1;
    running += 1;
    stats.maxConcurrent = Math.max(stats.maxConcurrent, running);
    const version = document.version;
    await Promise.resolve();
    whileInFlight();
    running -= 1;
    if (document.version !== version) { return false; }
    const ordered = edit.replacements
      .map(({ range, text }) => ({ start: document.offsetAt(range.start), end: document.offsetAt(range.end), text }))
      .sort((a, b) => b.start - a.start);
    for (const { start, end, text } of ordered) { document.change(start, end - start, text); }
    return true;
  });
  return stats;
}

function setup(initial: string) {
  const doc = new Y.Doc();
  const yText = doc.getText("file");
  yText.insert(0, initial);
  const document = fakeDocument(initial);
  const { logger, warnings, errors } = recordingLogger();
  const queue = new RemoteEditQueue(logger);
  const binding = bindDocument(document as unknown as vscode.TextDocument, yText, { queue, logger });
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  const fromPeer = (edit: (text: Y.Text) => void) => {
    const before = Y.encodeStateVector(doc);
    edit(peer.getText("file"));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, before), { peer: "remote" });
  };
  return { doc, yText, document, binding, warnings, errors, fromPeer };
}

describe("RemoteEditQueue", () => {
  afterEach(() => { (vscode.workspace.applyEdit as jest.Mock).mockReset(); });

  it("shows a peer's edit in the document without writing the echo back", async () => {
    const s = setup("hello");
    editorApplies(s.document);
    const updates: Uint8Array[] = [];
    s.doc.on("update", (update: Uint8Array) => updates.push(update));
    s.fromPeer((text) => text.insert(5, " world"));
    await s.binding.settled();
    expect(s.document.text).toBe("hello world");
    expect(updates).toHaveLength(1);
    s.binding.dispose();
  });

  it("sends the user's typing to the shared text", () => {
    const s = setup("ab");
    s.document.change(2, 0, "c");
    expect(s.yText.toString()).toBe("abc");
    s.binding.dispose();
  });

  it("waits for an edit in flight before applying a peer edit that arrives meanwhile", async () => {
    const s = setup("abc");
    let second = true;
    const stats = editorApplies(s.document, () => {
      if (second) { second = false; s.fromPeer((text) => text.insert(0, "2")); }
    });
    s.fromPeer((text) => text.insert(3, "1"));
    await s.binding.settled();
    expect(stats.maxConcurrent).toBe(1);
    expect(s.document.text).toBe("2abc1");
    expect(s.yText.toString()).toBe("2abc1");
    s.binding.dispose();
  });

  it("recomputes an edit the editor refused because the user typed while it was in flight", async () => {
    const s = setup("abc");
    let typed = false;
    const stats = editorApplies(s.document, () => {
      if (!typed) { typed = true; s.document.change(0, 0, "Q"); }
    });
    s.fromPeer((text) => text.insert(1, "X"));
    await s.binding.settled();
    expect(stats.calls).toBe(2);
    expect(s.document.text).toBe("QaXbc");
    expect(s.yText.toString()).toBe("QaXbc");
    expect(s.warnings).toEqual([]);
    s.binding.dispose();
  });

  it("gives up and logs when the editor keeps refusing the edit", async () => {
    const s = setup("abc");
    (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(false);
    s.fromPeer((text) => text.insert(0, "X"));
    await s.binding.settled();
    expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(20);
    expect(s.warnings).toEqual(["Gave up applying a shared edit the editor kept refusing"]);
    s.binding.dispose();
  });

  it("logs an edit that throws and stops", async () => {
    const s = setup("abc");
    (vscode.workspace.applyEdit as jest.Mock).mockRejectedValue(new Error("closed"));
    s.fromPeer((text) => text.insert(0, "X"));
    await s.binding.settled();
    expect(s.errors).toHaveLength(1);
    s.binding.dispose();
  });
});
