/** Verifies the index doc of a share: its kind and its typed maps. */
import * as Y from "yjs";
import {
  createShareIndexDoc,
  readShareIndexDocComments,
  readShareIndexDocFiles,
  readShareIndexDocSettings,
  readShareIndexDocKind,
  readWrittenVersions,
  addWrittenVersion,
  readWrittenHashes,
} from "../../src/collab/index";

describe("share index", () => {
  it("reads the kind a project index was created with", () => {
    const doc = new Y.Doc();
    createShareIndexDoc(doc);
    expect(readShareIndexDocKind(doc)).toEqual({ ok: true, kind: "project" });
  });

  it("returns unknownShareKind for a kind this version does not know", () => {
    const doc = new Y.Doc();
    doc.getMap("share").set("kind", "notebook");
    expect(readShareIndexDocKind(doc)).toEqual({ ok: false, error: "unknownShareKind", kind: "notebook" });
  });

  it("returns missingShareKind for an index without a kind", () => {
    expect(readShareIndexDocKind(new Y.Doc())).toEqual({ ok: false, error: "missingShareKind" });
  });

  it("keeps file entries, settings and comments in their own maps across a sync", () => {
    const doc = new Y.Doc();
    createShareIndexDoc(doc);
    readShareIndexDocFiles(doc).set("main.tex", { kind: "text" });
    readShareIndexDocFiles(doc).set("fig/a.png", { kind: "blob", hash: "ab12" });
    readShareIndexDocSettings(doc).set("format", "latex");
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    expect(readShareIndexDocFiles(peer).toJSON()).toEqual({ "main.tex": { kind: "text" }, "fig/a.png": { kind: "blob", hash: "ab12" } });
    expect(readShareIndexDocSettings(peer).get("format")).toBe("latex");
    expect(readShareIndexDocComments(peer).size).toBe(0);
    expect(readShareIndexDocKind(peer)).toEqual({ ok: true, kind: "project" });
  });
});

describe("written share versions", () => {
  it("appends distinct versions and skips only the newest duplicate", () => {
    const doc = new Y.Doc();
    readShareIndexDocFiles(doc).set("main.typ", { kind: "text" });
    addWrittenVersion(doc, "main.typ", "first", 1);
    addWrittenVersion(doc, "main.typ", "first", 2);
    addWrittenVersion(doc, "main.typ", "second", 3);
    addWrittenVersion(doc, "main.typ", "first", 4);
    expect(readWrittenVersions(doc).get("main.typ")?.toArray()).toEqual([
      { hash: "first", at: 1 }, { hash: "second", at: 3 }, { hash: "first", at: 4 },
    ]);
    expect(readWrittenHashes(doc, "main.typ")).toEqual(new Set(["first", "second"]));
    expect(readWrittenHashes(doc, "missing.typ")).toEqual(new Set());
  });

  it("retains the newest 200 entries independently per path", () => {
    const doc = new Y.Doc();
    readShareIndexDocFiles(doc).set("main.typ", { kind: "text" });
    readShareIndexDocFiles(doc).set("other.typ", { kind: "text" });
    addWrittenVersion(doc, "other.typ", "other", 0);
    for (let i = 0; i < 205; i++) { addWrittenVersion(doc, "main.typ", String(i), i); }
    const entries = readWrittenVersions(doc).get("main.typ")!.toArray();
    expect(entries).toHaveLength(200);
    expect(entries[0]).toEqual({ hash: "5", at: 5 });
    expect(entries[199]).toEqual({ hash: "204", at: 204 });
    expect(readWrittenHashes(doc, "other.typ")).toEqual(new Set(["other"]));
  });

  it("merges concurrent appends to a shared version array", () => {
    const doc = new Y.Doc();
    readShareIndexDocFiles(doc).set("main.typ", { kind: "text" });
    addWrittenVersion(doc, "main.typ", "initial", 0);
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    addWrittenVersion(doc, "main.typ", "mine", 1);
    addWrittenVersion(peer, "main.typ", "theirs", 2);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    expect(readWrittenHashes(doc, "main.typ")).toEqual(new Set(["initial", "mine", "theirs"]));
    expect(readWrittenVersions(doc).toJSON()).toEqual(readWrittenVersions(peer).toJSON());
  });

  it("preserves simultaneous first writes across three peers", () => {
    const seed = new Y.Doc();
    readShareIndexDocFiles(seed).set("main.typ", { kind: "text" });
    const peers = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
    peers.forEach((doc, i) => {
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed));
      addWrittenVersion(doc, "main.typ", `hash-${i}`, i);
    });
    for (let round = 0; round < 3; round++) {
      for (const source of peers) {
        for (const target of peers) { if (target !== source) { Y.applyUpdate(target, Y.encodeStateAsUpdate(source)); } }
      }
    }
    for (const doc of peers) {
      expect(readWrittenHashes(doc, "main.typ")).toEqual(new Set(["hash-0", "hash-1", "hash-2"]));
      expect(readWrittenVersions(doc).toJSON()).toEqual(readWrittenVersions(peers[0]!).toJSON());
    }
  });

  it("bounds concurrent appends after peers reach the retention cap", () => {
    const doc = new Y.Doc();
    readShareIndexDocFiles(doc).set("main.typ", { kind: "text" });
    for (let i = 0; i < 200; i++) { addWrittenVersion(doc, "main.typ", String(i), i); }
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    addWrittenVersion(doc, "main.typ", "mine", 200);
    addWrittenVersion(peer, "main.typ", "theirs", 201);
    for (let round = 0; round < 3; round++) {
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    }
    expect(readWrittenVersions(doc).get("main.typ")!.length).toBe(200);
    expect(readWrittenHashes(doc, "main.typ").size).toBe(200);
    expect(readWrittenHashes(doc, "main.typ").has("mine")).toBe(true);
    expect(readWrittenHashes(doc, "main.typ").has("theirs")).toBe(true);
    expect(readWrittenVersions(doc).toJSON()).toEqual(readWrittenVersions(peer).toJSON());
  });

  it("clears retained history when a path is deleted and created again", () => {
    const doc = new Y.Doc();
    readShareIndexDocFiles(doc).set("main.typ", { kind: "text" });
    addWrittenVersion(doc, "main.typ", "removed", 1);
    readShareIndexDocFiles(doc).delete("main.typ");
    readShareIndexDocFiles(doc).set("main.typ", { kind: "text" });
    addWrittenVersion(doc, "main.typ", "created", 2);
    expect(readWrittenHashes(doc, "main.typ")).toEqual(new Set(["created"]));
  });

  it("cleans written history when a remote file deletion arrives alone", () => {
    const doc = new Y.Doc();
    readShareIndexDocFiles(doc).set("main.typ", { kind: "text" });
    addWrittenVersion(doc, "main.typ", "first", 1);
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    peer.getMap("files").delete("main.typ");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
    expect(readWrittenVersions(doc).has("main.typ")).toBe(false);
  });

  it("removes history when a file leaves the index locally or through a peer", () => {
    const doc = new Y.Doc();
    readShareIndexDocFiles(doc).set("main.typ", { kind: "text" });
    addWrittenVersion(doc, "main.typ", "first", 1);
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    readShareIndexDocFiles(peer).delete("main.typ");
    expect(readWrittenVersions(peer).has("main.typ")).toBe(false);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
    expect(readWrittenVersions(doc).has("main.typ")).toBe(false);
  });
});
