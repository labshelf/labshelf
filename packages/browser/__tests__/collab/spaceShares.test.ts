// The page's Space catalog lists the library's Spaces under spaces/<id> with their share id, the PDF reader reads a paper's paper.pdf, and the tracker starts and stops the Space side of each Space connection.
import { posixPathOps, SpaceStore, type ILogger, type LibraryPapers, type PaperRecord, type ShareConnection } from "@labshelf/core";
import { createPaperPdfReader, createSpaceShareCatalog, trackSpaceShares } from "../../src/collab/spaceShares";
import { memoryLibraryFs } from "../support/memoryLibraryFs";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

describe("spaceShareCatalog", () => {
  it("lists every readable Space at spaces/<id> with its share id, after a reload sees a Space another store wrote", async () => {
    const fs = memoryLibraryFs();
    const page = new SpaceStore({ root: "", fs, paths: posixPathOps, logger });
    const catalog = createSpaceShareCatalog(page);
    await page.reload();
    expect(catalog.list()).toEqual([]);
    // A join writes through its own store over the same files.
    const joining = new SpaceStore({ root: "", fs, paths: posixPathOps, logger });
    const id = await joining.createSpace("Reading group");
    await joining.setShared(id, "a".repeat(32));
    const local = await joining.createSpace("Mine");
    await catalog.reload();
    expect(catalog.list()).toEqual(expect.arrayContaining([
      { id, name: "Reading group", folder: `spaces/${id}`, shared: "a".repeat(32) },
      { id: local, name: "Mine", folder: `spaces/${local}` },
    ]));
    expect(catalog.list()).toHaveLength(2);
  });
});

describe("paperPdfReader", () => {
  it("reads paper.pdf of a paper the records hold and nothing for one without a file or record", async () => {
    const fs = memoryLibraryFs();
    await fs.writeFile("papers/smith2020/paper.pdf", new Uint8Array([37, 80, 68, 70]));
    const papers: LibraryPapers = new Map([
      ["smith2020", { record: { id: "smith2020", path: "papers/smith2020" } as PaperRecord }],
      ["jones2021", { record: { id: "jones2021", path: "papers/jones2021" } as PaperRecord }],
    ]);
    const read = createPaperPdfReader(fs, () => papers);
    expect(await read("smith2020")).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(await read("jones2021")).toBeUndefined();
    expect(await read("absent")).toBeUndefined();
  });
});

describe("spaceShareLifecycle", () => {
  const connection = (shareId: string, kind: "project" | "space"): ShareConnection => ({ shareId, kind } as ShareConnection);

  it("attaches each Space connection once, stops it when it leaves the list or is replaced, and ignores project connections", () => {
    let list: ShareConnection[] = [];
    const listeners = new Set<() => void>();
    const shares = { list: () => list, onChange: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
    const change = (next: ShareConnection[]): void => { list = next; listeners.forEach((listener) => listener()); };
    const events: string[] = [];
    let opened = 0;
    const stop = trackSpaceShares(shares, (each) => {
      const run = ++opened;
      events.push(`attach ${each.shareId} #${run}`);
      return () => events.push(`stop ${each.shareId} #${run}`);
    });
    const space = connection("s1", "space");
    change([space, connection("p1", "project")]);
    change([space, connection("p1", "project")]);
    // A reopen after another tab let the lease go is a new connection of the same share.
    change([connection("s1", "space")]);
    change([]);
    change([connection("s2", "space")]);
    stop();
    change([connection("s3", "space")]);
    expect(events).toEqual(["attach s1 #1", "stop s1 #1", "attach s1 #2", "stop s1 #2", "attach s2 #3", "stop s2 #3"]);
    expect(listeners.size).toBe(0);
  });
});
