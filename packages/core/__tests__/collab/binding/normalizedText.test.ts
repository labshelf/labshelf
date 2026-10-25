/** Pins the editor ↔ Y.Text binding: CRLF offsets, echo guard, edits racing remote changes, undo reaching the editor. */
import * as Y from "yjs";
import { NormalizedText, TextUndoManager, type PendingChange, type TextChange } from "../../../src/collab/binding/index";
import { fakeLogger } from "../../support/fakeLogger";

const PEER = { peer: "remote" };

function applyAll(text: string, changes: readonly TextChange[]): string {
  let result = text;
  for (const change of [...changes].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, change.start) + change.text + result.slice(change.end);
  }
  return result;
}

/** A shared doc, a peer's replica of it, and an editor that the binding feeds through `nextEdit` like the VS Code queue. */
function setup(initial: string, editorText = initial) {
  const doc = new Y.Doc();
  const yText = doc.getText("file");
  if (initial) { yText.insert(0, initial.replace(/\r\n/g, "\n")); }
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  const undo = new TextUndoManager(yText, Symbol("local"));
  const logger = fakeLogger();
  let notified = 0;
  const text = new NormalizedText(yText, undo, () => { notified += 1; }, logger);
  const state = {
    doc, yText, peer, undo, text, logger, editor: editorText,
    get notified() { return notified; },
    /** The user edits the editor: the document changes, then VS Code reports it. */
    type(change: TextChange) {
      const before = state.editor;
      state.editor = applyAll(before, [change]);
      text.applyLocalChanges([change]);
    },
    /** One queued edit sent to the editor, not yet answered. */
    send(): PendingChange | undefined { return text.nextEdit(state.editor); },
    /** The editor applies the edit and reports it back, as VS Code does before `applyChange` resolves. */
    land(edit: PendingChange) {
      state.editor = applyAll(state.editor, edit.changes);
      text.applyLocalChanges(edit.changes);
      edit.settle();
    },
    flush() {
      for (let edit = state.send(); edit; edit = state.send()) { state.land(edit); }
    },
    fromPeer(edit: (peerText: Y.Text) => void) {
      const before = Y.encodeStateVector(doc);
      peer.transact(() => edit(peer.getText("file")));
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, before), PEER);
    },
    toPeer() { Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(peer))); },
  };
  text.attachLocalDocument(editorText);
  return state;
}

describe("NormalizedText offsets", () => {
  it("maps document offsets with CRLF to LF offsets and back", () => {
    const { text } = setup("ab\r\ncd\r\n");
    expect(text.toNormalizedOffset(2)).toBe(2);
    expect(text.toNormalizedOffset(4)).toBe(3);
    expect(text.toNormalizedOffset(8)).toBe(6);
    expect(text.toDocumentOffset(3)).toBe(4);
    expect(text.toDocumentOffset(6)).toBe(8);
  });

  it("writes a CRLF editor's change into the Y.Text with LF and LF offsets", () => {
    const s = setup("ab\r\ncd");
    s.type({ start: 5, end: 6, text: "X\r\nY" });
    expect(s.yText.toString()).toBe("ab\ncX\nY");
  });

  it("hands a remote change to the editor in document offsets and its line ends", () => {
    const s = setup("ab\r\ncd");
    s.fromPeer((peerText) => peerText.insert(5, "e\nf"));
    expect(s.notified).toBe(1);
    s.flush();
    expect(s.editor).toBe("ab\r\ncde\r\nf");
  });
});

describe("NormalizedText echo guard", () => {
  it("does not write a remote change back when the editor reports applying it", () => {
    const s = setup("hello");
    s.fromPeer((peerText) => peerText.insert(5, " world"));
    const updates: Uint8Array[] = [];
    s.doc.on("update", (update: Uint8Array) => updates.push(update));
    s.flush();
    expect(s.editor).toBe("hello world");
    expect(updates).toHaveLength(0);
    expect(s.yText.toString()).toBe("hello world");
  });

  it("still writes what the user types once the remote edit landed", () => {
    const s = setup("hello");
    s.fromPeer((peerText) => peerText.insert(0, ">"));
    s.flush();
    s.type({ start: 6, end: 6, text: "!" });
    expect(s.yText.toString()).toBe(">hello!");
  });
});

describe("NormalizedText under races", () => {
  it("places what the user types while a remote change is not in the editor yet", () => {
    const s = setup("abc");
    s.fromPeer((peerText) => peerText.insert(0, "X"));
    s.type({ start: 3, end: 3, text: "d" });
    expect(s.yText.toString()).toBe("Xabcd");
    s.flush();
    expect(s.editor).toBe("Xabcd");
  });

  it("recomputes an edit refused because the user typed meanwhile", () => {
    const s = setup("abc");
    s.fromPeer((peerText) => peerText.insert(1, "X"));
    const refused = s.send()!;
    s.type({ start: 0, end: 0, text: "Q" });
    // The editor's version changed, so VS Code refuses the edit without applying it.
    refused.settle();
    s.flush();
    expect(s.editor).toBe("QaXbc");
    expect(s.yText.toString()).toBe("QaXbc");
    s.toPeer();
    expect(s.peer.getText("file").toString()).toBe("QaXbc");
  });

  it("converges when the user deletes across text a peer deleted", () => {
    const s = setup("0123456789");
    s.fromPeer((peerText) => peerText.delete(2, 4));
    s.type({ start: 4, end: 8, text: "" });
    s.flush();
    expect(s.editor).toBe(s.yText.toString());
  });

  it("converges over random interleavings of typing, peer edits and refused edits", () => {
    let seed = 7;
    const random = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let run = 0; run < 60; run++) {
      const s = setup("one\r\ntwo\r\nthree");
      let inFlight: PendingChange | undefined;
      for (let step = 0; step < 40; step++) {
        const action = random(4);
        if (action === 0) {
          const at = random(s.editor.length + 1);
          const end = Math.min(s.editor.length, at + random(3));
          // A change never starts or ends inside a CRLF pair.
          if (s.editor[at - 1] === "\r" || s.editor[end - 1] === "\r") { continue; }
          if (inFlight) { inFlight.settle(); inFlight = undefined; }
          s.type({ start: at, end, text: random(2) ? "x" : "\r\n" });
        } else if (action === 1) {
          s.fromPeer((peerText) => {
            const at = random(peerText.length + 1);
            if (random(2)) { peerText.insert(at, "p"); } else { peerText.delete(at, Math.min(2, peerText.length - at)); }
          });
        } else if (action === 2 && !inFlight) {
          inFlight = s.send();
        } else if (inFlight) {
          s.land(inFlight);
          inFlight = undefined;
        }
      }
      inFlight?.settle();
      s.flush();
      s.toPeer();
      expect(s.editor.replace(/\r\n/g, "\n")).toBe(s.yText.toString());
      expect(s.peer.getText("file").toString()).toBe(s.yText.toString());
    }
  });
});

describe("NormalizedText with undo", () => {
  it("brings an undo to the editor and keeps the peer's text", () => {
    const s = setup("");
    s.type({ start: 0, end: 0, text: "hello" });
    s.fromPeer((peerText) => peerText.insert(5, " peer"));
    s.flush();
    s.undo.undo();
    s.flush();
    expect(s.editor).toBe(" peer");
    s.undo.redo();
    s.flush();
    // Yjs redoes a deletion as new text, so where it lands next to the peer's text is Yjs's choice.
    expect(s.editor).toBe(s.yText.toString());
    expect(s.editor.replace(" peer", "")).toBe("hello");
  });

  it("groups adjacent typing into one undo step", () => {
    const s = setup("");
    for (const [i, ch] of [..."abc"].entries()) { s.type({ start: i, end: i, text: ch }); }
    s.undo.undo();
    s.flush();
    expect(s.editor).toBe("");
  });
});

describe("NormalizedText attachLocalDocument", () => {
  it("reconciles a seed that arrives after the editor opened, instead of doubling it", () => {
    const s = setup("", "same content");
    s.fromPeer((peerText) => peerText.insert(0, "same content"));
    s.flush();
    expect(s.editor).toBe("same content");
  });

  it("replaces a differing editor text by a non-empty shared text at once", () => {
    const s = setup("shared", "local");
    s.flush();
    expect(s.editor).toBe("shared");
    expect(s.yText.toString()).toBe("shared");
  });

  it("shares an editor change it was not told about, and logs it", () => {
    const s = setup("abc");
    s.editor = "abcd";
    expect(s.send()).toBeUndefined();
    expect(s.yText.toString()).toBe("abcd");
    expect(s.logger.logs.map((entry) => entry.level)).toEqual(["WARN"]);
  });
});
