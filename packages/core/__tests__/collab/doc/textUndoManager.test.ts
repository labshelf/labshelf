/** Pins own-only undo of a shared text: native-like grouping, peers' edits kept, selections rebased. */
// ******************************************************************************
// Ported to Jest from p2p-live-share (src/fs/undo-manager.test.ts).
// Copyright 2025 _Kerman
// Made available under the terms of the MIT License, which is available in
// packages/core/src/collab/doc/LICENSE-p2p-live-share.md.
// ******************************************************************************
import * as Y from "yjs";

import { TextUndoManager } from "../../../src/collab/doc/index";

const LocalOrigin = Symbol("local");

class DocUndoManager extends TextUndoManager {
  constructor(doc: Y.Doc) { super(doc.getText(), LocalOrigin); }
}

describe("editor undo groups", () => {
  it("keeps adjacent typing together across ordinary typing pauses", async () => {
    const doc = new Y.Doc()
    const undo = new DocUndoManager(doc)
    undo.applyChanges([{ rangeOffset: 0, rangeLength: 0, text: "a" }])
    await new Promise(resolve => setTimeout(resolve, 300))
    undo.applyChanges([{ rangeOffset: 1, rangeLength: 0, text: "b" }])
    undo.undo()
    expect(doc.getText().toString()).toBe("")
    undo.redo()
    expect(doc.getText().toString()).toBe("ab")
    doc.destroy()
  })

  it("starts a separate group for a word, paste, replacement and distant edit", () => {
    const doc = new Y.Doc()
    const undo = new DocUndoManager(doc)
    for (const character of "one two")
      undo.applyChanges([{ rangeOffset: doc.getText().length, rangeLength: 0, text: character }])
    undo.undo()
    expect(doc.getText().toString()).toBe("one")
    undo.redo()
    undo.applyChanges([{ rangeOffset: 7, rangeLength: 0, text: "PASTE" }])
    undo.applyChanges([{ rangeOffset: 12, rangeLength: 0, text: "x" }])
    undo.applyChanges([{ rangeOffset: 0, rangeLength: 0, text: "y" }])
    undo.undo()
    expect(doc.getText().toString()).toBe("one twoPASTEx")
    undo.undo()
    expect(doc.getText().toString()).toBe("one twoPASTE")
    undo.undo()
    expect(doc.getText().toString()).toBe("one two")
    undo.applyChanges([{ rangeOffset: 0, rangeLength: 3, text: "ONE" }])
    undo.undo()
    expect(doc.getText().toString()).toBe("one two")
    doc.destroy()
  })

  it("separates incoming changes and explicit navigation from adjacent typing", () => {
    const doc = new Y.Doc()
    const undo = new DocUndoManager(doc)
    undo.applyChanges([{ rangeOffset: 0, rangeLength: 0, text: "a" }])
    doc.transact(() => doc.getText().insert(1, "X"), { peerId: "remote" })
    undo.applyChanges([{ rangeOffset: 1, rangeLength: 0, text: "b" }])
    undo.stopCapturing()
    undo.applyChanges([{ rangeOffset: 2, rangeLength: 0, text: "c" }])
    undo.undo()
    expect(doc.getText().toString()).toBe("abX")
    undo.undo()
    expect(doc.getText().toString()).toBe("aX")
    undo.undo()
    expect(doc.getText().toString()).toBe("X")
    doc.destroy()
  })

  it("separates typing, backward deletion and forward deletion", () => {
    const doc = new Y.Doc()
    const undo = new DocUndoManager(doc)
    for (const character of "abcde")
      undo.applyChanges([{ rangeOffset: doc.getText().length, rangeLength: 0, text: character }])
    undo.applyChanges([{ rangeOffset: 3, rangeLength: 1, text: "" }])
    undo.applyChanges([{ rangeOffset: 2, rangeLength: 1, text: "" }])
    undo.applyChanges([{ rangeOffset: 2, rangeLength: 1, text: "" }])
    undo.undo()
    expect(doc.getText().toString()).toBe("abe")
    undo.undo()
    expect(doc.getText().toString()).toBe("abcde")
    undo.undo()
    expect(doc.getText().toString()).toBe("")
    doc.destroy()
  })
})

describe("Y.UndoManager collaborative undo behavior", () => {
  it("restores directed selections and rebases them around remote edits", () => {
    const doc = new Y.Doc()
    doc.getText().insert(0, "abcd")
    const undo = new DocUndoManager(doc)
    undo.captureSelection([{ anchor: 3, active: 1 }, { anchor: 4, active: 4 }])
    doc.transact(() => {
      doc.getText().delete(1, 2)
      doc.getText().insert(1, "Z")
    }, LocalOrigin)
    doc.transact(() => doc.getText().insert(0, "X"), { peerId: "remote" })
    undo.captureSelection([{ anchor: 3, active: 3 }])
    undo.undo()
    expect(doc.getText().toString()).toBe("Xabcd")
    expect(undo.restoreSelection()).toEqual([{ anchor: 4, active: 2 }, { anchor: 5, active: 5 }])
    undo.captureSelection(undo.restoreSelection()!)
    undo.redo()
    expect(doc.getText().toString()).toBe("XaZd")
    expect(undo.restoreSelection()).toEqual([{ anchor: 3, active: 3 }])
    doc.destroy()
  })

  it("retains the selection before the first edit in a captured group", () => {
    const doc = new Y.Doc()
    const undo = new DocUndoManager(doc)
    undo.captureSelection([{ anchor: 0, active: 0 }])
    doc.transact(() => doc.getText().insert(0, "a"), LocalOrigin)
    undo.captureSelection([{ anchor: 1, active: 1 }])
    doc.transact(() => doc.getText().insert(1, "b"), LocalOrigin)
    undo.captureSelection([{ anchor: 2, active: 2 }])
    undo.undo()
    expect(doc.getText().toString()).toBe("")
    expect(undo.restoreSelection()).toEqual([{ anchor: 0, active: 0 }])
    undo.captureSelection(undo.restoreSelection()!)
    undo.redo()
    expect(undo.restoreSelection()).toEqual([{ anchor: 2, active: 2 }])
    doc.destroy()
  })

  it("keeps both peers in sync when each undoes and redoes their own interleaved edits", () => {
    const host = new Y.Doc()
    const guest = new Y.Doc()
    const hostUndo = new DocUndoManager(host)
    const guestUndo = new DocUndoManager(guest)
    const sync = (from: Y.Doc, to: Y.Doc) => Y.applyUpdateV2(to, Y.encodeStateAsUpdateV2(from), { peerId: from.clientID })
    const expectText = (text: string) => {
      expect(host.getText().toString()).toBe(text)
      expect(guest.getText().toString()).toBe(text)
    }

    host.transact(() => host.getText().insert(0, "hello"), LocalOrigin)
    sync(host, guest)
    guest.transact(() => guest.getText().insert(3, "X"), LocalOrigin)
    sync(guest, host)
    expectText("helXlo")

    hostUndo.undo()
    sync(host, guest)
    expectText("X")
    expect(hostUndo.undo()).toBe(null)

    guestUndo.undo()
    sync(guest, host)
    expectText("")
    guestUndo.redo()
    sync(guest, host)
    expectText("X")
    hostUndo.redo()
    sync(host, guest)
    expectText("helXlo")

    host.destroy()
    guest.destroy()
  })

  it("preserves remote edits received between undo and redo", () => {
    const host = new Y.Doc()
    const guest = new Y.Doc()
    const undo = new DocUndoManager(host)
    host.transact(() => host.getText().insert(0, "hello"), LocalOrigin)
    Y.applyUpdateV2(guest, Y.encodeStateAsUpdateV2(host))
    guest.getText().insert(3, "X")
    Y.applyUpdateV2(host, Y.encodeStateAsUpdateV2(guest), { peerId: "guest" })
    undo.undo()
    Y.applyUpdateV2(guest, Y.encodeStateAsUpdateV2(host))
    guest.getText().insert(1, "Y")
    Y.applyUpdateV2(host, Y.encodeStateAsUpdateV2(guest), { peerId: "guest" })
    expect(host.getText().toString()).toBe("XY")

    undo.redo()
    Y.applyUpdateV2(guest, Y.encodeStateAsUpdateV2(host))
    expect(host.getText().toString()).toBe(guest.getText().toString())
    expect(host.getText().toString().replace(/[XY]/g, "")).toBe("hello")
    undo.undo()
    Y.applyUpdateV2(guest, Y.encodeStateAsUpdateV2(host))
    expect(host.getText().toString()).toBe("XY")
    expect(guest.getText().toString()).toBe("XY")

    host.destroy()
    guest.destroy()
  })

  it("restores a local deletion without deleting a remote insertion", () => {
    const doc = new Y.Doc()
    doc.getText().insert(0, "abcd")
    const undo = new DocUndoManager(doc)
    doc.transact(() => doc.getText().delete(1, 2), LocalOrigin)
    doc.transact(() => doc.getText().insert(1, "X"), { peerId: "guest" })
    expect(doc.getText().toString()).toBe("aXd")
    undo.undo()
    expect(doc.getText().toString().replace("X", "")).toBe("abcd")
    undo.redo()
    expect(doc.getText().toString()).toBe("aXd")
    doc.destroy()
  })

  it("does not track initial content and releases its observers when the document is destroyed", () => {
    const doc = new Y.Doc()
    const undo = new DocUndoManager(doc)
    doc.getText().insert(0, "initial")
    expect(undo.undo()).toBe(null)
    doc.destroy()
    doc.transact(() => doc.getText().insert(0, "later"), LocalOrigin)
    expect(undo.undoStack.length).toBe(0)
  })

  it("tracks local changes, ignores remote changes", () => {
    const doc = new Y.Doc()
    const um = new DocUndoManager(doc)

    // A local edit
    doc.transact(() => {
      doc.getText().insert(0, "local")
    }, LocalOrigin)
    expect(um.undoStack.length).toBe(1)

    // A remote change (origin !== LocalOrigin)
    doc.transact(() => {
      doc.getText().insert(5, "-remote")
    }, { peerId: "peer" })
    expect(um.undoStack.length).toBe(1)

    expect(doc.getText().toString()).toBe("local-remote")

    // Undo reverts only the local change
    um.undo()
    expect(doc.getText().toString()).toBe("-remote")

    doc.destroy()
  })

  it("correctly undoes with concurrent interleaved edits", () => {
    const doc = new Y.Doc()
    const localUm = new DocUndoManager(doc)

    // The local user inserts "hello": 5 CRDT items
    doc.transact(() => {
      doc.getText().insert(0, "hello")
    }, LocalOrigin)

    expect(doc.getText().toString()).toBe("hello")

    // A remote peer inserts "X" between "hel" and "lo"
    // applyUpdateV2 stands in for a remote update: its origin is not LocalOrigin
    const remoteDoc = new Y.Doc()
    Y.applyUpdateV2(remoteDoc, Y.encodeStateAsUpdateV2(doc))
    remoteDoc.getText().insert(3, "X")
    const remoteUpdate = Y.encodeStateAsUpdateV2(remoteDoc)

    // Apply the remote update
    Y.applyUpdateV2(doc, remoteUpdate, { peerId: "remote" })
    expect(doc.getText().toString()).toBe("helXlo")

    // Local undo: the undo manager knows the CRDT items of "hello"
    localUm.undo()
    expect(doc.getText().toString()).toBe("X")

    doc.destroy()
    remoteDoc.destroy()
  })

  it("undo then redo restores original text", () => {
    const doc = new Y.Doc()
    const um = new DocUndoManager(doc)

    doc.transact(() => {
      doc.getText().insert(0, "test")
    }, LocalOrigin)

    expect(doc.getText().toString()).toBe("test")

    um.undo()
    expect(doc.getText().toString()).toBe("")

    um.redo()
    expect(doc.getText().toString()).toBe("test")

    expect(um.undoStack.length).toBe(1)
    expect(um.redoStack.length).toBe(0)

    doc.destroy()
  })

  it("only undoes local transactions, not remote ones mixed in between", () => {
    const doc = new Y.Doc()
    const um = new DocUndoManager(doc)

    // Local insert of "A"
    doc.transact(() => doc.getText().insert(0, "A"), LocalOrigin)
    // Remote insert of "B" after "A"
    doc.transact(() => doc.getText().insert(1, "B"), { peerId: "peer" })
    // Local insert of "C" after "B"
    doc.transact(() => doc.getText().insert(2, "C"), LocalOrigin)

    expect(doc.getText().toString()).toBe("ABC")
    expect(um.undoStack.length).toBe(2)

    // Undo every local transaction
    while (um.undoStack.length > 0)
      um.undo()

    expect(doc.getText().toString()).toBe("B")

    // Redo restores the local changes
    while (um.redoStack.length > 0)
      um.redo()

    expect(doc.getText().toString()).toBe("ABC")

    doc.destroy()
  })
})
