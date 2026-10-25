/** Verifies the index doc of a share: its kind and its typed maps. */
import * as Y from "yjs";
import { createProjectIndex, indexComments, indexFiles, indexSettings, readIndexKind } from "../../../src/collab/model/index";

describe("share index", () => {
  it("reads the kind a project index was created with", () => {
    const doc = new Y.Doc();
    createProjectIndex(doc);
    expect(readIndexKind(doc)).toEqual({ ok: true, kind: "project" });
  });

  it("returns unknownShareKind for a kind this version does not know", () => {
    const doc = new Y.Doc();
    doc.getMap("share").set("kind", "notebook");
    expect(readIndexKind(doc)).toEqual({ ok: false, error: "unknownShareKind", kind: "notebook" });
  });

  it("returns missingShareKind for an index without a kind", () => {
    expect(readIndexKind(new Y.Doc())).toEqual({ ok: false, error: "missingShareKind" });
  });

  it("keeps file entries, settings and comments in their own maps across a sync", () => {
    const doc = new Y.Doc();
    createProjectIndex(doc);
    indexFiles(doc).set("main.tex", { kind: "text" });
    indexFiles(doc).set("fig/a.png", { kind: "blob", hash: "ab12" });
    indexSettings(doc).set("format", "latex");
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    expect(indexFiles(peer).toJSON()).toEqual({ "main.tex": { kind: "text" }, "fig/a.png": { kind: "blob", hash: "ab12" } });
    expect(indexSettings(peer).get("format")).toBe("latex");
    expect(indexComments(peer).size).toBe(0);
    expect(readIndexKind(peer)).toEqual({ ok: true, kind: "project" });
  });
});
