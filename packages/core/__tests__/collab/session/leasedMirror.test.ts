/** Pins that one mirror at a time writes a shared project folder, and that a waiting mirror takes over once the lease frees. */
import { fileText, indexFiles } from "../../../src/collab/model/index";
import type { LeaseScheduler } from "../../../src/collab/ownership/index";
import { libraryMirrorDisk } from "../../../src/collab/mirror/index";
import { leasedMirrorFactory, type ShareConnection } from "../../../src/collab/session/index";
import { mergeText } from "../../../src/writing/merge/node/index";
import { runUntil, type FakeClock } from "../sync/fakeNetwork";
import { runFor } from "../transport/relay/fakeRelay";
import { FOLDER, Network, newDevice, writeProject, type Device } from "./connectionTestbed";

const LEASE = `${FOLDER}/.labshelf/mirror-lease.json`;

function leaseScheduler(clock: FakeClock): LeaseScheduler {
  return {
    now: () => clock.now(),
    delay: (ms) => new Promise((resolve) => { clock.after(ms, resolve); }),
    every: (ms, task) => {
      let cancel = (): void => undefined;
      const arm = (): void => { cancel = clock.after(ms, () => { arm(); task(); }); };
      arm();
      return () => cancel();
    },
  };
}

/** A host on `device`'s library whose mirror records the paths it writes. */
function host(net: Network, device: Device) {
  const writes: string[] = [];
  const startMirror = leasedMirrorFactory({
    identity: { id: async () => "11111111-1111-4111-8111-111111111111" },
    fs: device.catalog.fs, app: "vscode", logger: device.catalog.logger, mergeText, scheduler: leaseScheduler(net.clock),
    disk: (folder) => {
      const disk = libraryMirrorDisk(device.catalog.fs, folder);
      return { ...disk, write: async (path, bytes) => { writes.push(path); await disk.write(path, bytes); } };
    },
  });
  const connect = (mode: "share" | "resume"): Promise<ShareConnection> =>
    net.drive(net.connect(device, { mode, folder: FOLDER }, { startMirror }));
  return { writes, connect };
}

describe("a leased mirror", () => {
  it("lets one of two hosts on one folder write it, and the other takes over when the owner closes", async () => {
    const net = new Network();
    const ada = newDevice();
    await writeProject(ada);
    const first = host(net, ada);
    const second = host(net, ada);
    const owner = await first.connect("share");
    await runFor(net.clock, 2000);
    const waiting = await second.connect("resume");
    await runFor(net.clock, 2000);

    expect(owner.state().mirror).toEqual({ kind: "running" });
    expect(waiting.state().mirror).toMatchObject({ kind: "busy", holder: { app: "vscode" } });
    expect(waiting.mirror).toBeUndefined();

    // The owner's first scan adds main.typ to the share after real-time settle waits, so the edit must come after it.
    await net.drive(owner.mirror!.idle());
    expect(await runUntil(net.clock, () => indexFiles(owner.session.index).has("main.typ"))).toBe(true);
    fileText(owner.session.openDoc("main.typ")).insert(0, "Draft ");
    await runFor(net.clock, 3000);
    await net.drive(owner.mirror!.idle());
    expect(ada.read(`${FOLDER}/main.typ`)).toBe("Draft = Hello\n");
    expect(second.writes).toEqual([]);

    await net.drive(owner.close());
    expect(ada.read(LEASE)).toBeUndefined();
    await runFor(net.clock, 35_000, 500);
    expect(waiting.state().mirror).toEqual({ kind: "running" });
    expect(JSON.parse(ada.read(LEASE) ?? "{}")).toMatchObject({ app: "vscode" });
    await net.drive(waiting.close());
  }, 60_000);

  it("takes over from an owner that died once its lease expires", async () => {
    const net = new Network();
    const ada = newDevice();
    await writeProject(ada);
    await ada.catalog.fs.writeText(LEASE, JSON.stringify({ owner: "dead", app: "browser", renewedAt: net.clock.now(), ttlMs: 30_000 }));
    const survivor = host(net, ada);
    const connection = await survivor.connect("share");

    expect(connection.state().mirror).toMatchObject({ kind: "busy", holder: { app: "browser" } });
    await runFor(net.clock, 20_000, 500);
    expect(connection.state().mirror.kind).toBe("busy");
    await runFor(net.clock, 15_000, 500);
    expect(connection.state().mirror).toEqual({ kind: "running" });
    expect(JSON.parse(ada.read(LEASE) ?? "{}")).toMatchObject({ app: "vscode" });
    await net.drive(connection.close());
    expect(ada.read(LEASE)).toBeUndefined();
  }, 60_000);
});
