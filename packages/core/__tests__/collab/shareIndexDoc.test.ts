/** Verifies the index doc of a share: its kind and its typed maps, including the suggestions map. */
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
import { importCommentsFile } from "../../src/collab/commentsFile";
import { readLiveThreads } from "../../src/collab/comments";
import { serializeCommentsQmd } from "../../src/collab/commentsQmd";
import { readShareIndexDocSuggestions } from "../../src/collab/shareIndexDoc";
import { addLiveSuggestion, readLiveSuggestions, removeLiveSuggestions } from "../../src/collab/suggestions";
import { CREATED, byId, replicate, sortedIds, sugDel, sugIns, thread } from "./suggestionsFixtures";

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

describe("the suggestions map", () => {
  it("1.3a the map is the index doc's suggestions map", () => {
    const doc = new Y.Doc();
    expect(readShareIndexDocSuggestions(doc)).toBe(doc.getMap("suggestions"));
  });

  it("1.3a an added suggestion is read back unchanged", () => {
    const doc = new Y.Doc();
    const suggestion = sugIns("s1", CREATED, { group: "g1" });
    expect(addLiveSuggestion(doc, suggestion)).toBe(true);
    expect(readLiveSuggestions(doc)).toEqual([suggestion]);
  });

  it("1.3a an empty map reads no suggestions", () => {
    expect(readLiveSuggestions(new Y.Doc())).toEqual([]);
  });

  it("1.3a holds one Y.Map per suggestion keyed by id, with only plain values", () => {
    const doc = new Y.Doc();
    addLiveSuggestion(doc, sugDel("s2", CREATED, { group: "g1" }));
    const entry = readShareIndexDocSuggestions(doc).get("s2");
    expect(entry).toBeInstanceOf(Y.Map);
    for (const value of (entry as Y.Map<unknown>).values()) {
      expect(value instanceof Y.AbstractType).toBe(false);
    }
    expect((entry as Y.Map<unknown>).get("kind")).toBe("delete");
    expect((entry as Y.Map<unknown>).get("text")).toBe("old words");
  });

  it("1.3a keeps the relative positions of an anchor", () => {
    const doc = new Y.Doc();
    const suggestion = sugIns("s1", CREATED, { anchor: { quote: "brand new words", prefix: "so we add ", suffix: " here", start: "AQID", end: "BAUG" } });
    addLiveSuggestion(doc, suggestion);
    expect(readLiveSuggestions(doc)).toEqual([suggestion]);
  });

  it("1.3a refuses a suggestion whose id the map holds and keeps the first", () => {
    const doc = new Y.Doc();
    addLiveSuggestion(doc, sugIns("s1", CREATED));
    expect(addLiveSuggestion(doc, sugIns("s1", CREATED, { author: "Other" }))).toBe(false);
    expect(readLiveSuggestions(doc)).toEqual([sugIns("s1", CREATED)]);
  });

  it("1.3a refuses a duplicate even when its kind differs", () => {
    const doc = new Y.Doc();
    addLiveSuggestion(doc, sugIns("s1", CREATED));
    expect(addLiveSuggestion(doc, sugDel("s1", CREATED))).toBe(false);
    expect(readLiveSuggestions(doc)).toHaveLength(1);
    expect(readLiveSuggestions(doc)[0]!.kind).toBe("insert");
  });

  it("1.3a keeps the unknown keys of a record it adds", () => {
    const doc = new Y.Doc();
    addLiveSuggestion(doc, { ...sugIns("s1", CREATED), "x-extra": "keep-me", "x-count": 3 });
    const stored = (readShareIndexDocSuggestions(doc).get("s1") as Y.Map<unknown>).toJSON();
    expect(stored["x-extra"]).toBe("keep-me");
    expect(stored["x-count"]).toBe(3);
  });

  it("1.3a keeps the unknown keys after a read and when the map travels to a peer", () => {
    const doc = new Y.Doc();
    addLiveSuggestion(doc, { ...sugIns("s1", CREATED), "x-extra": "keep-me" });
    readLiveSuggestions(doc);
    const peer = replicate(doc);
    expect((readShareIndexDocSuggestions(peer).get("s1") as Y.Map<unknown>).get("x-extra")).toBe("keep-me");
    expect(readLiveSuggestions(peer)).toHaveLength(1);
  });

  it("1.3a skips entries that are not valid suggestions", () => {
    const doc = new Y.Doc();
    addLiveSuggestion(doc, sugIns("s1", CREATED));
    const map = readShareIndexDocSuggestions(doc);
    map.set("plain", { id: "plain", file: "main.tex" });
    const broken = new Y.Map<unknown>();
    broken.set("id", "broken");
    broken.set("kind", "insert");
    map.set("broken", broken);
    expect(readLiveSuggestions(doc).map((each) => each.id)).toEqual(["s1"]);
  });

  it("1.3a removes the listed ids and returns how many it removed", () => {
    const doc = new Y.Doc();
    for (const each of [sugIns("s1", CREATED), sugDel("s2", CREATED), sugIns("s3", CREATED)]) { addLiveSuggestion(doc, each); }
    expect(removeLiveSuggestions(doc, ["s1", "s3"])).toBe(2);
    expect(readLiveSuggestions(doc).map((each) => each.id)).toEqual(["s2"]);
  });

  it("1.3a counts only the ids the map held", () => {
    const doc = new Y.Doc();
    addLiveSuggestion(doc, sugIns("s1", CREATED));
    expect(removeLiveSuggestions(doc, ["s1", "nope", "nada"])).toBe(1);
    expect(removeLiveSuggestions(doc, ["s1"])).toBe(0);
    expect(removeLiveSuggestions(doc, [])).toBe(0);
    expect(readLiveSuggestions(doc)).toEqual([]);
  });

  it("1.3a removes every listed id in one transaction", () => {
    const doc = new Y.Doc();
    for (const each of [sugIns("s1", CREATED), sugDel("s2", CREATED), sugIns("s3", CREATED)]) { addLiveSuggestion(doc, each); }
    const updates = jest.fn();
    doc.on("update", updates);
    removeLiveSuggestions(doc, ["s1", "s2", "s3"]);
    expect(updates).toHaveBeenCalledTimes(1);
  });

  it("1.3a removing a suggestion does not expand its group", () => {
    const doc = new Y.Doc();
    addLiveSuggestion(doc, sugDel("s1", CREATED, { group: "g1" }));
    addLiveSuggestion(doc, sugIns("s2", CREATED, { group: "g1" }));
    removeLiveSuggestions(doc, ["s1"]);
    expect(readLiveSuggestions(doc).map((each) => each.id)).toEqual(["s2"]);
  });

  it("1.3a leaves the comments map and its threads alone", () => {
    const doc = new Y.Doc();
    importCommentsFile(doc, serializeCommentsQmd({ threads: [thread("t1")] }));
    addLiveSuggestion(doc, sugIns("s1", CREATED));
    removeLiveSuggestions(doc, ["s1"]);
    expect(readLiveThreads(doc).map((each) => each.id)).toEqual(["t1"]);
    expect(readShareIndexDocComments(doc).has("s1")).toBe(false);
  });

  it("1.3a members see the same suggestions in the same order", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    addLiveSuggestion(a, sugIns("s-b", "2026-10-21T08:00:00.000Z"));
    addLiveSuggestion(b, sugDel("s-a", "2026-10-20T08:00:00.000Z"));
    addLiveSuggestion(b, sugIns("s-c", "2026-10-20T08:00:00.000Z"));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readLiveSuggestions(a)).toEqual(readLiveSuggestions(b));
    expect(sortedIds(readLiveSuggestions(a))).toEqual(["s-a", "s-b", "s-c"]);
  });

  it("A1 records round-trip through the index doc map", () => {
    const doc = new Y.Doc();
    const suggestions = [
      sugDel("s1", "2026-10-20T08:00:00.000Z", { group: "g7", text: "first line\n\nsecond line" }),
      sugIns("s2", "2026-10-20T09:00:00.000Z", { group: "g7", anchor: { quote: "brand new words", prefix: "so we add ", suffix: " here", start: "AQID", end: "BAUG" } }),
      sugIns("s3", "2026-10-21T09:00:00.000Z"),
    ];
    for (const each of suggestions) { expect(addLiveSuggestion(doc, each)).toBe(true); }
    expect(byId(readLiveSuggestions(doc))).toEqual(byId(suggestions));
    expect(byId(readLiveSuggestions(replicate(doc)))).toEqual(byId(suggestions));
  });
});

