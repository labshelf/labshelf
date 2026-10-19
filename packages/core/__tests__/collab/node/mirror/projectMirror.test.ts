/** Pins that project files on disk follow the share docs and that outside edits, new files and deletes enter the docs. */
import * as Y from "yjs";
import { fileText, indexFiles, indexSettings, readSettingsMap, replaceFileText } from "../../../../src/collab/model/index";
import { DISK_ORIGIN } from "../../../../src/collab/node/index";
import { sha256Hex } from "../../../../src/hash/index";
import { exists, openMirror, pause, readFile, STABLE_MS, tempDir, writeFile, type MirrorFixture } from "./mirrorFixture";

function textFile(fixture: MirrorFixture, file: string, text: string): Y.Doc {
  const doc = fixture.session.openDoc(file);
  replaceFileText(doc, text, "remote");
  indexFiles(fixture.session.index).set(file, { kind: "text" });
  return doc;
}

function diskUpdates(doc: Y.Doc): Uint8Array[] {
  const updates: Uint8Array[] = [];
  doc.on("update", (update: Uint8Array, origin: unknown) => { if (origin === DISK_ORIGIN) { updates.push(update); } });
  return updates;
}

describe("project mirror", () => {
  let fixture: MirrorFixture;
  afterEach(async () => { await fixture.close(); });

  it("writes a doc to disk and does not take its own write back", async () => {
    fixture = await openMirror();
    const doc = textFile(fixture, "main.typ", "Hello");
    const fromDisk = diskUpdates(doc);
    await fixture.mirror.idle();
    expect(await readFile(fixture, "main.typ")).toBe("Hello");
    replaceFileText(doc, "Hello there", "remote");
    fixture.mirror.changed("main.typ");
    await fixture.mirror.idle();
    expect(await readFile(fixture, "main.typ")).toBe("Hello there");
    expect(fileText(doc).toString()).toBe("Hello there");
    expect(fromDisk).toEqual([]);
    expect(fixture.logger.log.mock.calls.some(([level, , message]) => level === "INFO" && /wrote/i.test(message))).toBe(true);
  });

  it("turns an outside edit into one small doc edit", async () => {
    fixture = await openMirror();
    const body = `${"intro ".repeat(2000)}MIDDLE${" outro".repeat(2000)}`;
    const doc = textFile(fixture, "main.typ", body);
    await fixture.mirror.idle();
    const fromDisk = diskUpdates(doc);
    await writeFile(fixture, "main.typ", body.replace("MIDDLE", "CENTRE"));
    fixture.mirror.changed("main.typ");
    await fixture.mirror.idle();
    expect(fileText(doc).toString()).toBe(body.replace("MIDDLE", "CENTRE"));
    expect(fromDisk).toHaveLength(1);
    expect(fromDisk[0]!.length).toBeLessThan(120);
  });

  it("ignores a half-written file until it is stable", async () => {
    fixture = await openMirror();
    const doc = textFile(fixture, "notes.md", "start");
    await fixture.mirror.idle();
    const seen: string[] = [];
    doc.on("update", () => seen.push(fileText(doc).toString()));
    const full = Buffer.from("start café", "utf8");
    await writeFile(fixture, "notes.md", full.subarray(0, full.length - 1));
    fixture.mirror.changed("notes.md");
    await pause(STABLE_MS * 4);
    expect(fileText(doc).toString()).toBe("start");
    await writeFile(fixture, "notes.md", full);
    fixture.mirror.changed("notes.md");
    await fixture.mirror.idle();
    expect(fileText(doc).toString()).toBe("start café");
    expect(seen.every((text) => !text.includes("�"))).toBe(true);
  });

  it("takes only the last of quick successive writes", async () => {
    fixture = await openMirror();
    const doc = textFile(fixture, "main.typ", "a");
    await fixture.mirror.idle();
    const seen: string[] = [];
    doc.on("update", () => seen.push(fileText(doc).toString()));
    await writeFile(fixture, "main.typ", "ab");
    fixture.mirror.changed("main.typ");
    await pause(STABLE_MS / 4);
    await writeFile(fixture, "main.typ", "abc");
    fixture.mirror.changed("main.typ");
    await fixture.mirror.idle();
    expect(seen).toEqual(["abc"]);
  });

  it("removes the index entry of a file that stays deleted, and keeps one that comes back", async () => {
    fixture = await openMirror();
    textFile(fixture, "gone.typ", "bye");
    textFile(fixture, "saved.typ", "kept");
    await fixture.mirror.idle();
    const { rm } = await import("node:fs/promises");
    await rm(`${fixture.folder}/gone.typ`);
    await rm(`${fixture.folder}/saved.typ`);
    fixture.mirror.changed("gone.typ");
    fixture.mirror.changed("saved.typ");
    await writeFile(fixture, "saved.typ", "kept again");
    fixture.mirror.changed("saved.typ");
    await fixture.mirror.idle();
    expect(indexFiles(fixture.session.index).has("gone.typ")).toBe(false);
    expect(indexFiles(fixture.session.index).get("saved.typ")).toEqual({ kind: "text" });
    expect(fileText(fixture.session.openDoc("saved.typ")).toString()).toBe("kept again");
  });

  it("deletes the file of a removed index entry", async () => {
    fixture = await openMirror();
    textFile(fixture, "chapters/old.typ", "old");
    await fixture.mirror.idle();
    expect(await exists(fixture, "chapters/old.typ")).toBe(true);
    indexFiles(fixture.session.index).delete("chapters/old.typ");
    await fixture.mirror.idle();
    expect(await exists(fixture, "chapters/old.typ")).toBe(false);
  });

  it("adds a new text file and a new binary file on disk to the share, and leaves unshared files out", async () => {
    fixture = await openMirror();
    await fixture.mirror.idle();
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 255, 1]);
    await writeFile(fixture, "sections/intro.typ", "= Intro");
    await writeFile(fixture, "figures/plot.png", png);
    await writeFile(fixture, ".git/HEAD", "ref");
    ["sections/intro.typ", "figures/plot.png", ".git/HEAD"].forEach((file) => fixture.mirror.changed(file));
    await fixture.mirror.idle();
    const files = indexFiles(fixture.session.index);
    expect(files.get("sections/intro.typ")).toEqual({ kind: "text" });
    expect(fileText(fixture.session.openDoc("sections/intro.typ")).toString()).toBe("= Intro");
    expect(files.get("figures/plot.png")).toEqual({ kind: "blob", hash: await sha256Hex(png) });
    expect(await fixture.store.blobs.get(await sha256Hex(png))).toEqual(png);
    expect(files.has(".git/HEAD")).toBe(false);
  });

  it("writes shared settings into labshelf.yaml keeping local keys, and takes local edits of shared keys", async () => {
    const folder = await tempDir("mirror-yaml");
    const local = "# my copy\nid: paper-a\nfolder: Work\nshared: abc\nformat: typst\nmain: main.typ\n";
    await (await import("node:fs/promises")).writeFile(`${folder}/labshelf.yaml`, local);
    fixture = await openMirror({ folder });
    await fixture.mirror.idle();
    const settings = indexSettings(fixture.session.index);
    expect(readSettingsMap(settings)).toEqual({ format: "typst", main: "main.typ" });

    settings.set("title", "Shared title");
    await fixture.mirror.idle();
    const written = await readFile(fixture, "labshelf.yaml");
    expect(written).toContain("# my copy\nid: paper-a\nfolder: Work\nshared: abc\n");
    expect(written).toContain("title: Shared title");

    await writeFile(fixture, "labshelf.yaml", written.replace("main: main.typ", "main: paper.typ").replace("folder: Work", "folder: Mine"));
    fixture.mirror.changed("labshelf.yaml");
    await fixture.mirror.idle();
    expect(readSettingsMap(settings)).toEqual({ format: "typst", main: "paper.typ", title: "Shared title" });
    expect(settings.has("folder")).toBe(false);
  });

  it("takes only the keys a local labshelf.yaml edit changed, so a concurrent remote change of another key stays", async () => {
    const folder = await tempDir("mirror-yaml-race");
    await (await import("node:fs/promises")).writeFile(`${folder}/labshelf.yaml`, "id: p\nformat: typst\nmain: main.typ\n");
    fixture = await openMirror({ folder });
    await fixture.mirror.idle();
    const settings = indexSettings(fixture.session.index);
    await writeFile(fixture, "labshelf.yaml", "id: p\nformat: typst\nmain: paper.typ\n");
    fixture.mirror.changed("labshelf.yaml");
    settings.set("title", "Remote title");
    await fixture.mirror.idle();
    expect(readSettingsMap(settings)).toEqual({ format: "typst", main: "paper.typ", title: "Remote title" });
    const written = await readFile(fixture, "labshelf.yaml");
    expect(written).toContain("main: paper.typ");
    expect(written).toContain("title: Remote title");
  });

  it("leaves a path the editor owns to the editor", async () => {
    fixture = await openMirror({ isEditorOwned: (file) => file === "open.typ" });
    textFile(fixture, "open.typ", "from peers");
    await fixture.mirror.idle();
    expect(await exists(fixture, "open.typ")).toBe(false);
  });

  it("restores files from the stored state after a restart and takes an offline edit", async () => {
    fixture = await openMirror();
    textFile(fixture, "main.typ", "one");
    await fixture.mirror.idle();
    const { folder, stateDir } = fixture;
    await fixture.close();
    await writeFile(fixture, "main.typ", "one two");
    fixture = await openMirror({ folder, stateDir, project: false });
    await fixture.mirror.idle();
    expect(fileText(fixture.session.openDoc("main.typ")).toString()).toBe("one two");
    expect(await readFile(fixture, "main.typ")).toBe("one two");
  });
});

describe("project mirror path safety", () => {
  let fixture: MirrorFixture;
  afterEach(async () => { await fixture.close(); });

  it("refuses and logs an index path that would leave the folder or overwrite the project file", async () => {
    fixture = await openMirror();
    for (const bad of ["../escape.typ", "/abs.typ", "a/../../x.typ", ".labshelf/comments.json"]) { indexFiles(fixture.session.index).set(bad, { kind: "text" }); }
    textFile(fixture, "ok.typ", "fine");
    await fixture.mirror.idle();
    expect(await readFile(fixture, "ok.typ")).toBe("fine");
    expect(await exists(fixture, ".labshelf/comments.json")).toBe(false);
    expect(await exists(fixture, "../escape.typ")).toBe(false);
    const refusals = fixture.logger.log.mock.calls.filter(([level, , message]) => level === "WARN" && /refused/i.test(message));
    expect(refusals.length).toBeGreaterThanOrEqual(4);
  });
});
