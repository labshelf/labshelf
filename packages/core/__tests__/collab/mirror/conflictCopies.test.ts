// Pins that project conflict copies stay local until the user dismisses their content match.
import { indexFiles } from "../../../src/collab/model/index";
import type { ConflictCopy } from "../../../src/library/conflicts/index";
import { FakeClock, runUntil } from "../peer/fakeNetwork";
import { FakeRelay } from "../transport/relay/fakeRelay";
import { memoryFiles } from "./mirrorFiles";
import { openMirror, readFile, writeFile, type MirrorFixture } from "./mirrorFixture";

const original = "Title\nIntro\nMiddle\nMore\nEnd\n";
const copy = "Title\nIntro\nMiddle\nMore\nOutside end\n";

describe("conflict copies in shared projects", () => {
  let fixtures: MirrorFixture[] = [];
  afterEach(async () => { await Promise.all(fixtures.map(fixture => fixture.close())); fixtures = []; });

  it("A7 holds a similar copy from the peer until dismissal", async () => {
    const clock = new FakeClock();
    const relay = new FakeRelay(clock);
    const files = memoryFiles();
    const offered: ConflictCopy[] = [];
    const dismissed: { path: string; hash: string }[] = [];
    const a = await openMirror({ files, clock, relay, onConflictCopy: conflict => { offered.push(conflict); }, readConflictDismissals: async () => dismissed });
    fixtures.push(a);
    await writeFile(a, "main.tex", original);
    a.mirror.changed("main.tex");
    await a.mirror.idle();
    const b = await openMirror({ files, clock, relay });
    fixtures.push(b);
    expect(await runUntil(clock, () => b.store.known.get("main.tex") !== undefined)).toBe(true);
    await writeFile(a, "main (1).tex", copy);
    a.mirror.changed("main (1).tex");
    await a.mirror.idle();
    expect(await runUntil(clock, () => offered.length === 1)).toBe(true);
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({ copy: `${a.folder}/main (1).tex`, original: `${a.folder}/main.tex`, match: "similar" });
    expect(indexFiles(a.session.index).has("main (1).tex")).toBe(false);
    expect(indexFiles(b.session.index).has("main (1).tex")).toBe(false);
    expect(await files.read(b.folder, "main (1).tex")).toBeUndefined();
    a.mirror.changed("main (1).tex");
    await a.mirror.idle();
    expect(offered).toHaveLength(1);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(copy));
    dismissed.push({ path: `${a.folder}/main (1).tex`, hash: Buffer.from(hash).toString("hex") });
    a.mirror.changed("main (1).tex");
    await a.mirror.idle();
    expect(await runUntil(clock, () => b.store.known.get("main (1).tex") === dismissed[0]!.hash)).toBe(true);
    expect(await readFile(b, "main (1).tex")).toBe(copy);
  });

  it("offers changed content despite a dismissal for the same path", async () => {
    const files = memoryFiles();
    const offered: ConflictCopy[] = [];
    const folder = await files.newFolder("copies");
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(copy));
    await files.write(folder, "labshelf.yaml", "id: external-project\nformat: latex\n");
    await files.write(folder, "main.tex", original);
    await files.write(folder, "main (1).tex", `${copy}Another line\n`);
    const a = await openMirror({ files, folder, onConflictCopy: conflict => { offered.push(conflict); },
      readConflictDismissals: async () => [{ path: `${folder}/main (1).tex`, hash: Buffer.from(hash).toString("hex") }] });
    fixtures.push(a);
    await a.mirror.idle();
    expect(offered).toHaveLength(1);
    expect(offered[0]?.owner).toEqual({ kind: "project", id: "external-project" });
    await writeFile(a, "main (1).tex", `${copy}A different line\n`);
    a.mirror.changed("main (1).tex");
    await a.mirror.idle();
    expect(offered).toHaveLength(2);
    expect(indexFiles(a.session.index).has("main (1).tex")).toBe(false);
  });

  it("holds recorded versions even when the canonical file has dissimilar content", async () => {
    const files = memoryFiles();
    const a = await openMirror({ files });
    fixtures.push(a);
    await a.mirror.idle();
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(copy));
    await a.writeRecords.append({ path: "long-canonical.tex", hash: Buffer.from(hash).toString("hex"), parent: null, by: "app", at: Date.now() });
    await writeFile(a, "long-canonical.tex", "Entirely different text\n");
    await writeFile(a, "x.tex", copy);
    a.mirror.changed("long-canonical.tex");
    a.mirror.changed("x.tex");
    await a.mirror.idle();
    expect(indexFiles(a.session.index).has("long-canonical.tex")).toBe(true);
    expect(indexFiles(a.session.index).has("x.tex")).toBe(false);
  });

  it("keeps listed files shared when their content becomes similar", async () => {
    const files = memoryFiles();
    const a = await openMirror({ files });
    fixtures.push(a);
    await writeFile(a, "main.tex", original);
    await writeFile(a, "chapter.tex", "A distinct chapter\n");
    a.mirror.changed("main.tex");
    a.mirror.changed("chapter.tex");
    await a.mirror.idle();
    expect(indexFiles(a.session.index).has("chapter.tex")).toBe(true);
    await writeFile(a, "chapter.tex", copy);
    a.mirror.changed("chapter.tex");
    await a.mirror.idle();
    expect(indexFiles(a.session.index).has("chapter.tex")).toBe(true);
    expect(await readFile(a, "chapter.tex")).toBe(copy);
  });

  it("holds copies on the first scan without a reporting callback", async () => {
    const files = memoryFiles();
    const folder = await files.newFolder("copies");
    await files.write(folder, "main.tex", original);
    await files.write(folder, "main (1).tex", copy);
    const a = await openMirror({ files, folder });
    fixtures.push(a);
    await a.mirror.idle();
    expect(indexFiles(a.session.index).has("main.tex")).toBe(true);
    expect(indexFiles(a.session.index).has("main (1).tex")).toBe(false);
  });
});
