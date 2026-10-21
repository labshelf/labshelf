/** Pins that sharing marks a project folder and its index, and that joining creates a library project under a free id. */
import * as Y from "yjs";
import { createProjectIndex, indexSettings, readIndexKind } from "../../../src/collab/model/index";
import { joinShare, startShare } from "../../../src/collab/share/index";
import { LIB, memoryCatalog, readText, writeTree } from "../../support/memoryProjectCatalog";

const SHARE_ID = "a".repeat(32);

function sharedIndex(settings: Record<string, unknown>): Y.Doc {
  const index = new Y.Doc();
  createProjectIndex(index);
  Object.entries(settings).forEach(([key, value]) => indexSettings(index).set(key, value));
  return index;
}

describe("startShare", () => {
  it("writes the share id into labshelf.yaml, keeping the rest and the title, and marks the index as a project's", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, "/p", { "labshelf.yaml": "# note\nid: p\nformat: typst\ntitle: Paper\n" });
    const index = new Y.Doc();
    await startShare(context, { folder: "/p", shareId: SHARE_ID, index });
    expect(readText(context.fs, "/p/labshelf.yaml")).toBe(`# note\nid: p\nformat: typst\ntitle: Paper\nshared: ${SHARE_ID}\n`);
    expect(readIndexKind(index)).toEqual({ ok: true, kind: "project" });
  });

  it("writes the id as the title of a project without one, so a joiner's copy takes the owner's name", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, "/p", { "labshelf.yaml": "id: deep-survey\nformat: typst\n" });
    await startShare(context, { folder: "/p", shareId: SHARE_ID, index: new Y.Doc() });
    expect(readText(context.fs, "/p/labshelf.yaml")).toBe(`id: deep-survey\nformat: typst\ntitle: deep-survey\nshared: ${SHARE_ID}\n`);
  });
});

describe("joinShare", () => {
  it("creates projects/<id>/ named by the shared title with the shared settings and the local keys", async () => {
    const context = memoryCatalog();
    const index = sharedIndex({ format: "typst", main: "main.typ", title: "Deep Survey" });
    const joined = await joinShare(context, { libraryRoot: LIB, shareId: SHARE_ID, index });
    expect(joined).toEqual({ id: "deep-survey", folder: `${LIB}/projects/deep-survey` });
    expect(readText(context.fs, `${joined.folder}/labshelf.yaml`)).toBe(
      `id: deep-survey\nshared: ${SHARE_ID}\nformat: typst\nmain: main.typ\ntitle: Deep Survey\n`,
    );
  });

  it("takes the usual suffix when the id is taken", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, `${LIB}/projects/deep-survey`, { "labshelf.yaml": "id: deep-survey\nformat: typst\n" });
    const joined = await joinShare(context, { libraryRoot: LIB, shareId: SHARE_ID, index: sharedIndex({ format: "typst", title: "Deep Survey" }) });
    expect(joined.id).not.toBe("deep-survey");
    expect(joined.id.startsWith("deep-survey")).toBe(true);
  });

  it("refuses a share that is not a project", async () => {
    const index = new Y.Doc();
    index.getMap("share").set("kind", "notebook");
    await expect(joinShare(memoryCatalog(), { libraryRoot: LIB, shareId: SHARE_ID, index })).rejects.toThrow(/notebook/);
    await expect(joinShare(memoryCatalog(), { libraryRoot: LIB, shareId: SHARE_ID, index: new Y.Doc() })).rejects.toThrow(/kind/);
  });
});
