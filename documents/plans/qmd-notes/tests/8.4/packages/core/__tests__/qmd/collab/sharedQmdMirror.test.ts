// Pins that a shared .qmd file reaches disk byte for byte from its doc, that an outside edit enters the doc by item, and that text docs behave as before.
import * as Y from "yjs";
import { readFileText, readShareIndexDocFiles, setFileText, deriveSharedFileKind } from "../../../src/collab/index";
import { DISK_ORIGIN } from "../../../src/collab/mirror/index";
import { readQmdDoc, readQmdDocText, setQmdDocText } from "../../../src/qmd/collab/sharedQmdDoc";
import { nodeFiles } from "../../collab/mirror/mirrorFiles";
import { openMirror, readFile, writeFile, type MirrorFixture } from "../../collab/mirror/mirrorFixture";
import { qmdFixtures } from "../fixtures/qmdFixtures";

const item = (id: string, body: string): string => `::: {#${id} .labshelf-item author="Ana"}\n${body}\n:::\n`;
const base = `Intro text.\n\n${item("n-AAA", "First body.")}\n${item("n-BBB", "Second body.")}`;

function qmdDoc(fixture: MirrorFixture, file: string, text: string): Y.Doc {
  const doc = fixture.session.openDoc(file);
  setQmdDocText(doc, text, "remote");
  readShareIndexDocFiles(fixture.session.index).set(file, { kind: "qmd" } as never);
  return doc;
}

function textDoc(fixture: MirrorFixture, file: string, text: string): Y.Doc {
  const doc = fixture.session.openDoc(file);
  setFileText(doc, text, "remote");
  readShareIndexDocFiles(fixture.session.index).set(file, { kind: "text" });
  return doc;
}

function diskUpdates(doc: Y.Doc): Uint8Array[] {
  const updates: Uint8Array[] = [];
  doc.on("update", (update: Uint8Array, origin: unknown) => { if (origin === DISK_ORIGIN) { updates.push(update); } });
  return updates;
}

const readBytes = async (fixture: MirrorFixture, file: string): Promise<Buffer> => Buffer.from((await fixture.files.read(fixture.folder, file))!);

describe("qmd mirror", () => {
  let fixture: MirrorFixture;
  afterEach(async () => { await fixture.close(); });

  it.each(qmdFixtures().map((entry) => [entry.name, entry.text] as const))("8.4b writes %s from the doc to disk byte for byte", async (_name, text) => {
    fixture = await openMirror({ files: nodeFiles });
    qmdDoc(fixture, "notes/a.qmd", text);
    await fixture.mirror.idle();
    expect(await readBytes(fixture, "notes/a.qmd")).toEqual(Buffer.from(text, "utf8"));
  });

  it("8.4b writes a later doc edit to disk and does not take its own write back", async () => {
    fixture = await openMirror({ files: nodeFiles });
    const doc = qmdDoc(fixture, "a.qmd", base);
    const fromDisk = diskUpdates(doc);
    await fixture.mirror.idle();
    const edited = base.replace("First body.", "First body, edited.");
    setQmdDocText(doc, edited, "remote");
    fixture.mirror.changed("a.qmd");
    await fixture.mirror.idle();
    expect(await readFile(fixture, "a.qmd")).toBe(edited);
    expect(readQmdDocText(doc)).toBe(edited);
    expect(fromDisk).toEqual([]);
  });

  it("8.4b takes an outside edit into the doc and keeps the bodies of the untouched items", async () => {
    fixture = await openMirror({ files: nodeFiles });
    const doc = qmdDoc(fixture, "a.qmd", base);
    await fixture.mirror.idle();
    const bodies = readQmdDoc(doc).get("bodies") as Y.Map<Y.XmlFragment>;
    const first = bodies.get("n-AAA");
    const edited = base.replace("Second body.", "Second body, edited outside.");
    await writeFile(fixture, "a.qmd", edited);
    fixture.mirror.changed("a.qmd");
    await fixture.mirror.idle();
    expect(readQmdDocText(doc)).toBe(edited);
    expect(bodies.get("n-AAA")).toBe(first);
    expect(await readFile(fixture, "a.qmd")).toBe(edited);
  });

  it("8.4b takes an item added outside into the doc", async () => {
    fixture = await openMirror({ files: nodeFiles });
    const doc = qmdDoc(fixture, "a.qmd", base);
    await fixture.mirror.idle();
    const edited = `${base}\n${item("n-CCC", "Third body.")}`;
    await writeFile(fixture, "a.qmd", edited);
    fixture.mirror.changed("a.qmd");
    await fixture.mirror.idle();
    expect(readQmdDocText(doc)).toBe(edited);
    expect((readQmdDoc(doc).get("order") as Y.Array<string>).toArray()).toContain("n-CCC");
  });

  it("8.4b adds a new .qmd file on disk to the share as a qmd doc", async () => {
    fixture = await openMirror({ files: nodeFiles });
    await writeFile(fixture, "new.qmd", base);
    fixture.mirror.changed("new.qmd");
    await fixture.mirror.idle();
    expect(readShareIndexDocFiles(fixture.session.index).get("new.qmd")?.kind).toBe("qmd");
    expect(readQmdDocText(fixture.session.openDoc("new.qmd"))).toBe(base);
  });
});

describe("text docs beside qmd docs", () => {
  let fixture: MirrorFixture;
  afterEach(async () => { await fixture.close(); });

  it("8.4c keeps the Y.Text content of a markdown file and writes it to disk", async () => {
    fixture = await openMirror({ files: nodeFiles });
    const doc = textDoc(fixture, "notes.md", "Hello");
    const fromDisk = diskUpdates(doc);
    await fixture.mirror.idle();
    expect(await readFile(fixture, "notes.md")).toBe("Hello");
    setFileText(doc, "Hello there", "remote");
    fixture.mirror.changed("notes.md");
    await fixture.mirror.idle();
    expect(await readFile(fixture, "notes.md")).toBe("Hello there");
    expect(readFileText(doc).toString()).toBe("Hello there");
    expect(fromDisk).toEqual([]);
    expect(doc.share.has("qmd")).toBe(false);
  });

  it("8.4c turns an outside edit of a text file into a text edit", async () => {
    fixture = await openMirror({ files: nodeFiles });
    const doc = textDoc(fixture, "main.typ", "= Title\nBody\n");
    await fixture.mirror.idle();
    await writeFile(fixture, "main.typ", "= Title\nBody changed\n");
    fixture.mirror.changed("main.typ");
    await fixture.mirror.idle();
    expect(readFileText(doc).toString()).toBe("= Title\nBody changed\n");
  });

  it("8.4c adds a new text file on disk to the share as a text doc", async () => {
    fixture = await openMirror({ files: nodeFiles });
    await writeFile(fixture, "main.tex", "\\section{A}\n");
    fixture.mirror.changed("main.tex");
    await fixture.mirror.idle();
    expect(readShareIndexDocFiles(fixture.session.index).get("main.tex")?.kind).toBe("text");
    expect(readFileText(fixture.session.openDoc("main.tex")).toString()).toBe("\\section{A}\n");
  });

  it("8.4c still derives text for text extensions and blob for others", () => {
    const bytes = new TextEncoder().encode("text");
    expect(deriveSharedFileKind("main.tex", bytes)).toBe("text");
    expect(deriveSharedFileKind("notes.md", bytes)).toBe("text");
    expect(deriveSharedFileKind("plot.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff]))).toBe("blob");
  });

  it("8.4c derives the qmd kind for a .qmd path", () => {
    expect(deriveSharedFileKind("notes/a.qmd", new TextEncoder().encode(base))).toBe("qmd");
  });
});
