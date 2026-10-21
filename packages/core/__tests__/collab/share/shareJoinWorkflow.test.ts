/** Pins sharing and joining a project: the invite one device hands out is the one another joins, and failures leave nothing behind. */
import { formatInvite, parseInvite } from "../../../src/collab/invite/index";
import { joinSharedProject, shareProject, type ShareOutcome } from "../../../src/collab/share/index";
import { runFor } from "../transport/relay/fakeRelay";
import { FOLDER, Network, writeProject } from "../session/connectionTestbed";
import { ONE } from "../relays/relayGroup";
import { closeAll, workflowDevice, type WorkflowDevice } from "./workflowTestbed";

const never = () => new AbortController().signal;

async function shared(net: Network, ada: WorkflowDevice): Promise<Extract<ShareOutcome, { kind: "shared" }>> {
  await writeProject(ada);
  await ada.ports.projects.reload();
  const outcome = await net.drive(shareProject(ada.ports, { folder: FOLDER, shared: undefined, signal: never() }));
  if (outcome.kind !== "shared") { throw new Error(`not shared: ${outcome.kind}`); }
  await net.drive(outcome.connection.mirror!.idle());
  await runFor(net.clock, 5000);
  return outcome;
}

describe("sharing and joining a project", () => {
  it("hands out an invite with the owner's relay that another device joins", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    const grace = workflowDevice(net, "grace");
    const { invite, connection } = await shared(net, ada);

    const parsed = await parseInvite(invite);
    expect(parsed.ok && parsed.invite.relays).toEqual([{ url: ONE }]);
    expect(ada.keys.get(connection.shareId)?.relays).toEqual([{ url: ONE }]);
    expect(ada.read(`${FOLDER}/labshelf.yaml`)).toContain(`shared: ${connection.shareId}`);

    const joined = await net.drive(joinSharedProject(grace.ports, invite, never()));
    expect(joined).toEqual({ kind: "joined", folder: "/lib/projects/thesis" });
    await runFor(net.clock, 3000);
    expect(grace.read("/lib/projects/thesis/main.typ")).toBe("= Hello\n");
    expect(grace.keys.has(connection.shareId)).toBe(true);
    await closeAll(net, ada, grace);
  }, 60_000);

  it("reconnects an active or known project on a repeat join without creating another", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    const grace = workflowDevice(net, "grace");
    const { invite, connection } = await shared(net, ada);
    const first = await net.drive(joinSharedProject(grace.ports, invite, never()));

    expect(await joinSharedProject(grace.ports, invite, never())).toEqual({ kind: "active", folder: first.kind === "refused" ? "" : first.folder });
    await grace.ports.shares.remove(connection.shareId);
    const again = await net.drive(joinSharedProject(grace.ports, invite, never()));
    expect(again).toEqual({ kind: "resumed", folder: "/lib/projects/thesis" });
    expect(grace.projectFolders()).toEqual(["/lib/projects/thesis"]);
    await closeAll(net, ada, grace);
  }, 60_000);

  it("refuses an invite that does not parse or lists no relay, and creates nothing", async () => {
    const net = new Network();
    const grace = workflowDevice(net, "grace");
    const connect = jest.spyOn(grace.ports, "connect");
    const noRelay = await formatInvite({ shareKey: new Uint8Array(16).fill(7), relays: [] });

    expect(await joinSharedProject(grace.ports, "hello", never())).toEqual({ kind: "refused", problem: "This is not a LabShelf invite link." });
    expect((await joinSharedProject(grace.ports, noRelay, never())).kind).toBe("refused");
    expect(await joinSharedProject(grace.ports, `${noRelay.slice(0, -4)}.x`, never())).toMatchObject({ kind: "refused" });
    expect(connect).not.toHaveBeenCalled();
    expect(grace.catalog.fs.fileList()).toEqual([]);
    expect(grace.keys.size).toBe(0);
  });

  it("rolls back the key, the shared field and the state when the share is cancelled", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    await writeProject(ada);
    const cancel = new AbortController();
    const connect = ada.ports.connect;
    ada.ports.connect = async (invite, start) => { const connection = await connect(invite, start); cancel.abort(); return connection; };

    await expect(net.drive(shareProject(ada.ports, { folder: FOLDER, shared: undefined, signal: cancel.signal }))).rejects.toThrow(/cancelled/);
    expect(ada.keys.size).toBe(0);
    expect(ada.open.size).toBe(0);
    expect(ada.states.size).toBe(0);
    expect(ada.read(`${FOLDER}/labshelf.yaml`)).toBe("id: thesis\ntitle: Thesis\nformat: typst\nmain: main.typ\n");
  }, 60_000);

  it("rolls back the shared field a share wrote when the mirror fails to start after placing the project", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada", async () => { throw new Error("the mirror could not start"); });
    await writeProject(ada);

    await expect(net.drive(shareProject(ada.ports, { folder: FOLDER, shared: undefined, signal: never() }))).rejects.toThrow("mirror");
    expect(ada.keys.size).toBe(0);
    expect(ada.open.size).toBe(0);
    expect(ada.read(`${FOLDER}/labshelf.yaml`)).toBe("id: thesis\ntitle: Thesis\nformat: typst\nmain: main.typ\n");
  }, 60_000);

  it("rolls back a new share and reports the error when the owner's relay refuses the claim", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    await writeProject(ada);
    ada.ports.fetch = async () => { throw new TypeError("fetch failed"); };

    await expect(net.drive(shareProject(ada.ports, { folder: FOLDER, shared: undefined, signal: never() }))).rejects.toThrow(/relay/);
    expect(ada.keys.size).toBe(0);
    expect(ada.open.size).toBe(0);
    expect(ada.states.size).toBe(0);
    expect(ada.read(`${FOLDER}/labshelf.yaml`)).toBe("id: thesis\ntitle: Thesis\nformat: typst\nmain: main.typ\n");
  }, 60_000);

  it("publishes nothing when no relay gets connected", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    await writeProject(ada);
    ada.ports.relay = { get: async () => undefined };
    const requireRelay = jest.fn(async () => false);
    ada.ports.requireRelay = requireRelay;
    const connect = jest.spyOn(ada.ports, "connect");

    expect(await shareProject(ada.ports, { folder: FOLDER, shared: undefined, signal: never() })).toEqual({ kind: "noRelay" });
    expect(requireRelay).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
    expect(ada.keys.size).toBe(0);
  });

  it("re-copies the invite of a shared project from its stored key, reconnecting it first", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    const { connection } = await shared(net, ada);
    await ada.ports.shares.remove(connection.shareId);

    const again = await net.drive(shareProject(ada.ports, { folder: FOLDER, shared: connection.shareId, signal: never() }));
    expect(again.kind).toBe("shared");
    expect(ada.open.has(connection.shareId)).toBe(true);
    ada.keys.clear();
    await ada.ports.shares.remove(connection.shareId);
    expect(await shareProject(ada.ports, { folder: FOLDER, shared: connection.shareId, signal: never() })).toEqual({ kind: "noKey" });
    await closeAll(net, ada);
  }, 60_000);
});
