/** Pins the connection lifecycle both apps share: start, join, rollback of a partial start, close ordering and persistence. */
import { readFileText } from "../../../src/collab/doc/index";
import { ONE } from "../relays/relayGroup";
import { runFor } from "../transport/relay/fakeRelay";
import { FOLDER, mirrorFactory, Network, newDevice, writeProject } from "./connectionTestbed";

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
    expect(JSON.parse(grace.read(`${member.folder}/.labshelf/comments.json`) ?? "{}").threads.map((each: { id: string }) => each.id)).toEqual(["t1"]);
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
