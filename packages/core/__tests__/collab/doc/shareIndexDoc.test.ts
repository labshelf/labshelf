/** Verifies the index doc of a share: its kind and its typed maps. */
import * as Y from "yjs";
import { createShareIndexDoc, readShareIndexDocComments, readShareIndexDocFiles, readShareIndexDocSettings, readShareIndexDocKind } from "../../../src/collab/doc/index";

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
