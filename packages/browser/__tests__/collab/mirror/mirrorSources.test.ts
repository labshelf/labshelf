/** Pins that a browser project mirror writes only to the storage of its library source and follows edits made in a folder. */
import { FOLDER, openTestbed, running, until, type Testbed } from "./mirrorTestbed";

const FILE = `${FOLDER}/main.typ`;

describe("browser project mirror sources", () => {
  let bed: Testbed;
  afterEach(async () => { await bed.close(); });

  it("mirrors a peer edit to browser storage for a browser library", async () => {
    bed = await openTestbed("browser");
    const mirror = running(await bed.start());
    bed.peerEdit("main.typ", "Hello");
    mirror.changed("main.typ");
    await until(async () => (await bed.browserFs.text(FILE)) === "Hello");
    expect(bed.folderFs.writes).toEqual([]);
    expect(bed.stops).toEqual([]);
  });

  it("writes only to the folder for a folder library", async () => {
    bed = await openTestbed("folder");
    const mirror = running(await bed.start());
    bed.peerEdit("main.typ", "Hello");
    mirror.changed("main.typ");
    await until(async () => (await bed.folderFs.text(FILE)) === "Hello");
    await mirror.idle();
    expect(bed.browserFs.writes).toEqual([]);
  });

  it("takes an edit made in the folder outside the browser into the share on a rescan", async () => {
    bed = await openTestbed("folder");
    const mirror = running(await bed.start());
    bed.peerEdit("main.typ", "Hello");
    mirror.changed("main.typ");
    await until(async () => (await bed.folderFs.text(FILE)) === "Hello");
    await mirror.idle();
    bed.scheduler.fire();
    await mirror.idle();
    await bed.folderFs.writeText(FILE, "Hello from outside");
    await until(() => bed.docText("main.typ") === "Hello from outside", () => bed.scheduler.fire());
    expect(bed.stops).toEqual([]);
  });

  it("stops with root-unavailable when the folder permission is lost, leaving browser storage alone", async () => {
    bed = await openTestbed("folder");
    running(await bed.start());
    bed.folderFs.failing = true;
    await until(() => bed.stops.length > 0, () => bed.scheduler.fire());
    expect(bed.stops).toEqual(["root-unavailable"]);
    expect(bed.browserFs.writes).toEqual([]);
  });
});
