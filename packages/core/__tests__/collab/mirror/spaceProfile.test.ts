// Pins how a shared Space's folder follows its share: space.json and glossary.json merge by entry, notes travel as files, and per-user keys stay.
import { readShareIndexDocFiles } from "../../../src/collab/index";
import { FakeClock, runUntil } from "../fakeNetwork";
import { FakeRelay } from "../relays/fakeRelay";
import { memoryFiles } from "./mirrorFiles";
import { openMirror, readFile, writeFile, type MirrorFixture } from "./mirrorFixture";

const spaceJson = (fields: Record<string, unknown>) => `${JSON.stringify({ version: 1, ...fields }, null, 2)}\n`;
/** Advances the fake clock until `done`, which may read the disk. */
async function settle(clock: FakeClock, done: () => Promise<boolean>): Promise<boolean> {
  for (let step = 0; step < 200; step += 1) {
    if (await done()) { return true; }
    await runUntil(clock, () => false, 200);
  }
  return done();
}

const readJson = async (fixture: MirrorFixture, file: string) => JSON.parse(await readFile(fixture, file)) as Record<string, unknown>;

describe("the mirror of a shared Space", () => {
  let fixtures: MirrorFixture[] = [];
  afterEach(async () => { await Promise.all(fixtures.map((fixture) => fixture.close())); fixtures = []; });

  async function pair() {
    const clock = new FakeClock();
    const relay = new FakeRelay(clock);
    const files = memoryFiles();
    const owner = await files.newFolder("owner-space");
    await files.write(owner, "space.json", spaceJson({
      name: "Attention", purpose: "Read the transformer papers", createdAt: "2026-01-01T00:00:00Z", icon: "brain", archived: true,
      shared: "aaaa", folders: [{ id: "f1", name: "Core" }], papers: [{ id: "vaswani2017attention", folder: "f1", focus: true }],
      projects: ["thesis"], dates: [], desk: [{ kind: "paper", ref: "vaswani2017attention" }],
    }));
    await files.write(owner, "glossary.json", `${JSON.stringify({ version: 1, terms: [{ id: "t1", term: "Attention", definition: "Weighted sum" }] }, null, 2)}\n`);
    await files.write(owner, "notes/reading.qmd", "::: {#a1}\n# Reading\n:::\n");
    await files.write(owner, ".labshelf/private.txt", "not shared");
    const a = await openMirror({ files, clock, relay, folder: owner, space: true });
    fixtures.push(a);
    await a.mirror.idle();
    const joiner = await files.newFolder("joiner-space");
    await files.write(joiner, "space.json", spaceJson({ name: "Attention", shared: "aaaa", icon: "star", folders: [], papers: [], projects: [], dates: [] }));
    const b = await openMirror({ files, clock, relay, folder: joiner, space: true });
    fixtures.push(b);
    expect(await settle(clock, async () => (await b.files.read(b.folder, "notes/reading.qmd")) !== undefined
      && new TextDecoder().decode(await b.files.read(b.folder, "notes/reading.qmd")).includes("# Reading") && b.store.known.get("glossary.json") !== undefined
      && (await readJson(b, "space.json"))["purpose"] !== undefined)).toBe(true);
    return { clock, a, b };
  }

  it("gives a joiner the shared keys, notes and glossary while each member keeps their own keys", async () => {
    const { b } = await pair();
    const space = await readJson(b, "space.json");
    expect(space).toMatchObject({ name: "Attention", purpose: "Read the transformer papers", icon: "star", shared: "aaaa", projects: [] });
    expect(space["archived"]).toBeUndefined();
    expect(space["desk"]).toBeUndefined();
    expect(space["papers"]).toEqual([{ id: "vaswani2017attention", folder: "f1" }]);
    expect(space["folders"]).toEqual([{ id: "f1", name: "Core" }]);
    expect((await readJson(b, "glossary.json"))["terms"]).toEqual([{ id: "t1", term: "Attention", definition: "Weighted sum" }]);
    expect(await readFile(b, "notes/reading.qmd")).toContain("# Reading");
    expect(readShareIndexDocFiles(b.session.index).has(".labshelf/private.txt")).toBe(false);
    expect(readShareIndexDocFiles(b.session.index).has("space.json")).toBe(false);
  });

  it("keeps the papers both members add at once and each member's focus", async () => {
    const { clock, a, b } = await pair();
    const ownerSpace = await readJson(a, "space.json");
    const joinerSpace = await readJson(b, "space.json");
    await writeFile(a, "space.json", spaceJson({ ...ownerSpace, papers: [...ownerSpace["papers"] as unknown[], { id: "devlin2019bert" }] }));
    await writeFile(b, "space.json", spaceJson({ ...joinerSpace, papers: [...joinerSpace["papers"] as unknown[], { id: "brown2020language", focus: true }] }));
    a.mirror.changed("space.json");
    b.mirror.changed("space.json");
    const ids = async (fixture: MirrorFixture) => ((await readJson(fixture, "space.json"))["papers"] as { id: string }[]).map((paper) => paper.id).sort();
    const all = ["brown2020language", "devlin2019bert", "vaswani2017attention"];
    expect(await settle(clock, async () => JSON.stringify(await ids(a)) === JSON.stringify(all) && JSON.stringify(await ids(b)) === JSON.stringify(all))).toBe(true);
    const ownerPapers = (await readJson(a, "space.json"))["papers"] as Record<string, unknown>[];
    expect(ownerPapers.find((paper) => paper["id"] === "vaswani2017attention")?.["focus"]).toBe(true);
    expect(ownerPapers.find((paper) => paper["id"] === "brown2020language")?.["focus"]).toBeUndefined();
    expect((await readJson(a, "space.json"))["desk"]).toEqual([{ kind: "paper", ref: "vaswani2017attention" }]);
  });

  it("removes for everyone a paper one member removes", async () => {
    const { clock, a, b } = await pair();
    const joinerSpace = await readJson(b, "space.json");
    await writeFile(b, "space.json", spaceJson({ ...joinerSpace, papers: [] }));
    b.mirror.changed("space.json");
    expect(await settle(clock, async () => ((await readJson(a, "space.json"))["papers"] as unknown[]).length === 0)).toBe(true);
  });
});
