/** Pins that the browser project mirror follows the caller's tab lease without releasing it, and that VS Code's folder lease keeps it busy. */
import { openTabLease, createTabLeaseName, updateTabLease } from "../../../src/storage";
import { FOLDER, LIBRARY_ID, openTestbed, running, SHARE_ID, until, type Testbed } from "./mirrorTestbed";

const FILE = `${FOLDER}/main.typ`;
const TAB = createTabLeaseName(LIBRARY_ID, SHARE_ID);

describe("browser project mirror ownership", () => {
  let bed: Testbed;
  afterEach(async () => { await bed.close(); });

  it("leaves the tab lease held by the caller when it closes", async () => {
    bed = await openTestbed("browser");
    await running(await bed.start()).close();
    expect(await openTabLease(TAB)).toEqual({ kind: "busy" });
    expect(bed.stops).toEqual([]);
  });

  it("stops and writes nothing to disk once another tab took the tab lease", async () => {
    bed = await openTestbed("browser");
    const mirror = running(await bed.start());
    const stolen = await updateTabLease(TAB);
    await until(() => bed.stops.length > 0);
    expect(bed.stops).toEqual(["tab-taken"]);
    bed.peerEdit("main.typ", "Hello");
    mirror.changed("main.typ");
    await mirror.idle();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bed.browserFs.writes).toEqual([]);
    await stolen.release();
  });

  it("is busy with the folder holder while VS Code holds a live folder lease, until it takes over", async () => {
    bed = await openTestbed("folder");
    const lease = { owner: "vscode-owner", app: "vscode", renewedAt: Date.now(), ttlMs: 30_000 };
    await bed.folderFs.writeText(`${FOLDER}/.labshelf/mirror-lease.json`, JSON.stringify(lease));
    const result = await bed.start();
    if (result.kind !== "busy") { throw new Error("expected busy"); }
    expect(result.holder).toEqual({ app: "vscode", renewedAt: lease.renewedAt });
    const mirror = running(await result.takeOver());
    bed.peerEdit("main.typ", "Hello");
    mirror.changed("main.typ");
    await until(async () => (await bed.folderFs.text(FILE)) === "Hello");
    expect(bed.stops).toEqual([]);
  });
});
