/** Pins that two members' project folders converge, text and blobs, through a fake relay only. */
import { readFileSync, existsSync, promises as fs } from "node:fs";
import * as path from "node:path";
import { indexSettings } from "../../../src/collab/model/index";
import { joinShare, startShare } from "../../../src/collab/share/index";
import { nodeProjectCatalogContext } from "../../../src/writing/project/node/index";
import { FakeClock, runUntil } from "../sync/fakeNetwork";
import { fakeLogger, SHARE_ID } from "../sync/testSession";
import { FakeRelay } from "../transport/relay/fakeRelay";
import { tempDir } from "./mirrorFiles";
import { openMirror, type MirrorFixture } from "./mirrorFixture";

const read = (folder: string, file: string) => {
  const full = path.join(folder, file);
  return existsSync(full) ? readFileSync(full) : undefined;
};

describe("two mirrors", () => {
  let fixtures: MirrorFixture[] = [];
  afterEach(async () => { await Promise.all(fixtures.map((f) => f.close())); fixtures = []; });

  it("converge a text file and a blob from the owner's folder into the joiner's new project", async () => {
    const env = { ...process.env };
    process.env["XDG_STATE_HOME"] = await tempDir("two-mirrors-xdg");
    try {
      const clock = new FakeClock();
      const relay = new FakeRelay(clock);
      const owner = await tempDir("owner");
      const png = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 7) % 256);
      await fs.writeFile(path.join(owner, "labshelf.yaml"), "id: survey\nformat: typst\nmain: main.typ\ntitle: Deep Survey\n");
      await fs.writeFile(path.join(owner, "main.typ"), "= Survey\n");
      await fs.mkdir(path.join(owner, "figures"));
      await fs.writeFile(path.join(owner, "figures", "plot.png"), png);
      const logger = fakeLogger();
      const a = await openMirror({ relay, clock, folder: owner, project: false });
      fixtures.push(a);
      await startShare(nodeProjectCatalogContext(logger), { folder: owner, shareId: SHARE_ID, index: a.session.index });
      a.mirror.changed("labshelf.yaml");
      await a.mirror.idle();

      const library = await tempDir("joiner-library");
      const b = await openMirror({ relay, clock, project: false });
      fixtures.push(b);
      expect(await runUntil(clock, () => indexSettings(b.session.index).get("title") === "Deep Survey")).toBe(true);
      const joined = await joinShare(nodeProjectCatalogContext(logger), { libraryRoot: library, shareId: SHARE_ID, index: b.session.index });
      expect(joined.folder).toBe(path.join(library, "projects", "deep-survey"));
      await b.close();
      fixtures = [a];
      const member = await openMirror({ relay, clock, folder: joined.folder, project: false });
      fixtures.push(member);

      expect(await runUntil(clock, () =>
        read(joined.folder, "main.typ")?.toString() === "= Survey\n" && read(joined.folder, "figures/plot.png")?.equals(Buffer.from(png)) === true,
      )).toBe(true);
      const yaml = read(joined.folder, "labshelf.yaml")!.toString();
      expect(yaml).toContain("id: deep-survey");
      expect(yaml).toContain(`shared: ${SHARE_ID}`);
      expect(yaml).toContain("main: main.typ");

      await fs.writeFile(path.join(joined.folder, "main.typ"), "= Survey\nBy both.\n");
      member.mirror.changed("main.typ");
      expect(await runUntil(clock, () => read(owner, "main.typ")?.toString() === "= Survey\nBy both.\n")).toBe(true);
    } finally {
      process.env = env;
    }
  });
});
