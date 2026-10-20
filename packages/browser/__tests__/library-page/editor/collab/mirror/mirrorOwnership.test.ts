/** Pins that one tab per library and share owns the browser project mirror, and that VS Code's folder lease keeps it busy. */
import { acquireTabLease, tabLeaseName, takeOverTabLease } from "../../../../../src/storage";
import type { BrowserMirrorStopReason } from "../../../../../src/library-page/editor/collab/mirror";
import { FOLDER, LIBRARY_ID, openTestbed, running, SHARE_ID, until, type Testbed } from "./mirrorTestbed";

const FILE = `${FOLDER}/main.typ`;

describe("browser project mirror ownership", () => {
  let bed: Testbed;
  afterEach(async () => { await bed.close(); });

  it("reports a second instance busy until it takes over, which stops the first", async () => {
    bed = await openTestbed("browser");
    const firstStops: BrowserMirrorStopReason[] = [];
    running(await bed.start(firstStops));
    const second = await bed.start();
    if (second.kind !== "busy") { throw new Error("expected busy"); }
    expect(second.holder).toBe("tab");
    const mirror = running(await second.takeOver());
    await until(() => firstStops.length > 0);
    expect(firstStops).toEqual(["tab-taken"]);
    bed.peerEdit("main.typ", "Hello");
    mirror.changed("main.typ");
    await until(async () => (await bed.browserFs.text(FILE)) === "Hello");
    expect(bed.stops).toEqual([]);
  });

  it("writes nothing to disk once another tab took the lease", async () => {
    bed = await openTestbed("browser");
    const mirror = running(await bed.start());
    const stolen = await takeOverTabLease(tabLeaseName(LIBRARY_ID, SHARE_ID));
    await until(() => bed.stops.length > 0);
    expect(bed.stops).toEqual(["tab-taken"]);
    bed.peerEdit("main.typ", "Hello");
    mirror.changed("main.typ");
    await mirror.idle();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bed.browserFs.writes).toEqual([]);
    await stolen.release();
  });

  it("is busy while VS Code holds a live folder lease, and frees the tab lease", async () => {
    bed = await openTestbed("folder");
    const lease = { owner: "vscode-owner", app: "vscode", renewedAt: Date.now(), ttlMs: 30_000 };
    await bed.folderFs.writeText(`${FOLDER}/.labshelf/mirror-lease.json`, JSON.stringify(lease));
    const result = await bed.start();
    expect(result.kind).toBe("busy");
    if (result.kind === "busy") { expect(result.holder).toEqual({ app: "vscode", renewedAt: lease.renewedAt }); }
    const tab = await acquireTabLease(tabLeaseName(LIBRARY_ID, SHARE_ID));
    expect(tab.kind).toBe("owned");
    if (tab.kind === "owned") { await tab.lease.release(); }
  });
});
