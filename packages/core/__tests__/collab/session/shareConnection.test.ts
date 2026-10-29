/** Pins the connection lifecycle both apps share: start, join, rollback of a partial start, close ordering and persistence failure; how connections pick relays; and that one leased mirror at a time writes a shared project folder. */
import { readFileText, readShareIndexDocFiles } from "../../../src/collab/index";
import { parseCommentsQmd } from "../../../src/collab/commentsQmd";
import { createLibraryMirrorFileSystem, type LeaseScheduler } from "../../../src/collab/mirror/index";
import { createLeasedMirrorFactory, type ShareConnection } from "../../../src/collab/session/index";
import { mergeText } from "../../../src/writing/conflict/node/index";
import { runUntil, type FakeClock } from "../fakeNetwork";
import { ONE, TWO } from "../relays/relayGroup";
import { runFor } from "../relays/fakeRelay";
import { FOLDER, mirrorFactory, Network, newDevice, writeProject, type Device } from "./connectionTestbed";

const COMMENTS = { threads: [{ id: "t1", file: "main.typ", anchor: { quote: "Hello", prefix: "= ", suffix: "" }, resolved: false, comments: [{ id: "c1", author: "Ada", body: "Why?", createdAt: "2026-10-20T10:00:00.000Z" }] }] };

describe("a share connection", () => {
  it("shares a project with its comments, and a member who joins gets its files and threads", async () => {
    const net = new Network();
    const ada = newDevice();
    await writeProject(ada, COMMENTS);
    const owner = await net.connect(ada, { mode: "share", folder: FOLDER });
    await net.drive(owner.mirror!.idle());
    await runFor(net.clock, 5000);
    const grace = newDevice();
    const joining = net.connect(grace, { mode: "join", signal: new AbortController().signal });
    await runFor(net.clock, 10_000);
    const member = await joining;
    await runFor(net.clock, 3000);

    expect(member.joinedId).toBe("thesis");
    expect(grace.read(`${member.folder}/main.typ`)).toBe("= Hello\n");
    expect(parseCommentsQmd(grace.read(`${member.folder}/.labshelf/comments.qmd`) ?? "")?.threads.map((each) => each.id)).toEqual(["t1"]);
    expect(member.state()).toMatchObject({ status: "open", mirror: { kind: "running" }, persistenceFailure: undefined });
    await net.drive(member.close());
    await net.drive(owner.close());
  }, 60_000);

  it("releases relays, transport and state when a join is cancelled before any member answers", async () => {
    const net = new Network();
    const grace = newDevice();
    const cancel = new AbortController();
    const startMirror = jest.fn(mirrorFactory(grace));
    const joining = net.connect(grace, { mode: "join", signal: cancel.signal }, { startMirror });
    const failed = expect(joining).rejects.toThrow(/cancelled/);
    await runFor(net.clock, 3000);
    cancel.abort();
    await failed;
    await runFor(net.clock, 1000);
    const after = net.requests();
    await runFor(net.clock, 120_000, 1000);

    expect(net.requests()).toBe(after);
    expect(startMirror).not.toHaveBeenCalled();
    expect(net.hosts.relay(ONE).liveSockets).toBe(0);
  }, 60_000);

  it("closes what started when the mirror cannot start", async () => {
    const net = new Network();
    const ada = newDevice();
    await writeProject(ada);
    const failing = net.connect(ada, { mode: "share", folder: FOLDER }, { startMirror: async () => { throw new Error("no disk"); } });
    await expect(failing).rejects.toThrow("no disk");
    await runFor(net.clock, 1000);
    const after = net.requests();
    await runFor(net.clock, 120_000, 1000);
    expect(net.requests()).toBe(after);
  }, 60_000);

  it("stores every pending update before close resolves", async () => {
    const net = new Network();
    const ada = newDevice();
    await writeProject(ada);
    const connection = await net.connect(ada, { mode: "share", folder: FOLDER });
    await net.drive(connection.mirror!.idle());
    await runFor(net.clock, 2000);
    const append = ada.storage.appendUpdate;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    ada.storage.appendUpdate = async (docId, update) => { await gate; await append(docId, update); };
    readFileText(connection.session.openDoc("main.typ")).insert(0, "Draft ");
    let closed = false;
    const closing = connection.close().then(() => { closed = true; });
    await runFor(net.clock, 1000);
    expect(closed).toBe(false);
    release();
    await net.drive(closing);

    const again = await net.connect(ada, { mode: "resume", folder: FOLDER });
    await net.drive(again.mirror!.idle());
    expect(readFileText(again.session.openDoc("main.typ")).toString()).toBe("Draft = Hello\n");
    await net.drive(again.close());
  }, 60_000);

  it("reports state it cannot store, and close rejects while it stays unstored", async () => {
    const net = new Network();
    const ada = newDevice();
    await writeProject(ada);
    const connection = await net.connect(ada, { mode: "share", folder: FOLDER });
    await net.drive(connection.mirror!.idle());
    await runFor(net.clock, 2000);
    const changes = jest.fn();
    connection.onStateChange(changes);
    ada.storage.failAppends = true;
    ada.storage.failCompactions = true;
    readFileText(connection.session.openDoc("main.typ")).insert(0, "x");
    await runFor(net.clock, 500);

    expect(connection.state().persistenceFailure).toBe("disk full");
    expect(changes).toHaveBeenCalled();
    await expect(net.drive(connection.close())).rejects.toThrow(/not stored/);
  }, 60_000);

  it("resumes again and again from stored state and per-relay cursors, also with no relay up", async () => {
    const net = new Network();
    const ada = newDevice();
    await writeProject(ada);
    const first = await net.connect(ada, { mode: "share", folder: FOLDER });
    await net.drive(first.mirror!.idle());
    await runFor(net.clock, 3000);
    readFileText(first.session.openDoc("main.typ")).insert(0, "1");
    await runFor(net.clock, 3000);
    await net.drive(first.close());
    expect(Object.keys(ada.storage.maps.get("relay-cursors") as object).some((key) => key.startsWith(ONE))).toBe(true);

    for (const letter of ["2", "3"]) {
      const again = await net.connect(ada, { mode: "resume", folder: FOLDER });
      await net.drive(again.mirror!.idle());
      await runFor(net.clock, 3000);
      readFileText(again.session.openDoc("main.typ")).insert(0, letter);
      await runFor(net.clock, 3000);
      await net.drive(again.close());
    }
    net.hosts.set(ONE, "limit");
    const offline = await net.connect(ada, { mode: "resume", folder: FOLDER });
    await net.drive(offline.mirror!.idle());
    await runFor(net.clock, 3000);
    expect(readFileText(offline.session.openDoc("main.typ")).toString()).toBe("321= Hello\n");
    expect(ada.read(`${FOLDER}/main.typ`)).toBe("321= Hello\n");
    await net.drive(offline.close());
  }, 60_000);
});

const BOTH = [ONE, TWO];

async function owner(net: Network) {
  const ada = newDevice();
  await writeProject(ada);
  const connection = await net.connect(ada, { mode: "share", folder: FOLDER }, { relays: BOTH });
  await net.drive(connection.mirror!.idle());
  return { ada, connection };
}

async function join(net: Network) {
  const grace = newDevice();
  const connection = await net.drive(net.connect(grace, { mode: "join", signal: new AbortController().signal }, { relays: BOTH }));
  await net.drive(connection.mirror!.idle());
  return { grace, connection };
}

describe("share connection relays", () => {
  it("connects through the second relay when the first one fails", async () => {
    const net = new Network();
    net.hosts.set(ONE, "limit");
    const { connection: a } = await owner(net);
    await runFor(net.clock, 10_000);
    const { grace, connection: b } = await join(net);

    expect([a.state().relay, b.state().relay]).toEqual([TWO, TWO]);
    expect(grace.read(`${b.folder}/main.typ`)).toBe("= Hello\n");
    await net.drive(b.close());
    await net.drive(a.close());
  }, 60_000);

  it("brings in a member whose fresh socket the first relay refuses while the group stays connected there", async () => {
    const net = new Network();
    const { connection: a } = await owner(net);
    await runFor(net.clock, 5000);
    expect(a.state().relay).toBe(ONE);
    net.hosts.set(ONE, "refuseNew");
    readFileText(a.session.openDoc("main.typ")).insert(0, "Late ");
    const { grace, connection: b } = await join(net);
    await runFor(net.clock, 30_000);

    expect(b.state().relay).toBe(TWO);
    expect(readFileText(b.session.openDoc("main.typ")).toString()).toBe("Late = Hello\n");
    await net.drive(b.mirror!.idle());
    expect(grace.read(`${b.folder}/main.typ`)).toBe("Late = Hello\n");
    await net.drive(b.close());
    await net.drive(a.close());
  }, 60_000);

  it("elects exactly one connected member as the relay snapshot writer, and hands it over when that member leaves", async () => {
    const net = new Network();
    const { connection: a } = await owner(net);
    await runFor(net.clock, 5000);
    const { connection: b } = await join(net);
    await runFor(net.clock, 5000);
    const writers = [a, b].filter((each) => each.presence.isLowestId());
    expect(writers).toHaveLength(1);

    const [writer] = writers;
    const other = writer === a ? b : a;
    await net.drive(writer!.close());
    await runFor(net.clock, 5000);
    expect(other.presence.isLowestId()).toBe(true);
    await net.drive(other.close());
  }, 60_000);
});

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
  const startMirror = createLeasedMirrorFactory({
    identity: { id: async () => "11111111-1111-4111-8111-111111111111" },
    fs: device.catalog.fs, app: "vscode", logger: device.catalog.logger, mergeText, scheduler: leaseScheduler(net.clock),
    disk: (folder) => {
      const disk = createLibraryMirrorFileSystem(device.catalog.fs, folder);
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
    expect(await runUntil(net.clock, () => readShareIndexDocFiles(owner.session.index).has("main.typ"))).toBe(true);
    readFileText(owner.session.openDoc("main.typ")).insert(0, "Draft ");
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
