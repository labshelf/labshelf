/** Pins leaving and resuming a shared project, and the invite and relay list the owner's relay offer and withdrawal keep. */
import { parseInvite } from "../../../src/collab/invite/index";
import { addRelay, readRelayList } from "../../../src/collab/relays/index";
import {
  createShareResumer, readCurrentInvite, leaveSharedProject, offerOwnRelay, ShareOpenInAnotherTabError, startProjectShare, removeOwnRelayOffer, removeOwnRelayOfferFromShares,
} from "../../../src/collab/share/index";
import { encodeRelayBody } from "../../../src/relay/index";
import { runFor } from "../transport/relay/fakeRelay";
import { FOLDER, Network, writeProject } from "../session/connectionTestbed";
import { ONE, TWO } from "../relays/relayGroup";
import { closeAll, workflowDevice, type WorkflowDevice } from "./workflowTestbed";

async function sharedOn(net: Network, ada: WorkflowDevice) {
  await writeProject(ada);
  await ada.ports.projects.reload();
  const outcome = await net.drive(startProjectShare(ada.ports, { folder: FOLDER, shared: undefined, signal: new AbortController().signal }));
  if (outcome.kind !== "shared") { throw new Error(`not shared: ${outcome.kind}`); }
  await net.drive(outcome.connection.mirror!.idle());
  await runFor(net.clock, 2000);
  return outcome.connection;
}

const noReports = () => ({ missingKey: jest.fn(), failed: jest.fn() });

describe("leaving a shared project", () => {
  it("keeps the key, the shared field and the files when the connection cannot store its edits", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    const { shareId } = await sharedOn(net, ada);
    ada.ports.shares.remove = async () => { throw new Error("disk full"); };

    await expect(leaveSharedProject(ada.ports, { folder: FOLDER, shareId })).rejects.toThrow(/stays shared.*disk full/);
    expect(ada.keys.has(shareId)).toBe(true);
    expect(ada.states.has(shareId)).toBe(true);
    expect(ada.read(`${FOLDER}/labshelf.yaml`)).toContain(`shared: ${shareId}`);
    expect(ada.read(`${FOLDER}/main.typ`)).toBe("= Hello\n");
    await closeAll(net, ada);
  }, 60_000);

  it("forgets the key, the shared field and the stored state, and keeps the files", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    const { shareId } = await sharedOn(net, ada);

    await leaveSharedProject(ada.ports, { folder: FOLDER, shareId });
    expect(ada.open.size).toBe(0);
    expect(ada.keys.has(shareId)).toBe(false);
    expect(ada.states.has(shareId)).toBe(false);
    expect(ada.read(`${FOLDER}/labshelf.yaml`)).toBe("id: thesis\ntitle: Thesis\nformat: typst\nmain: main.typ\n");
    expect(ada.read(`${FOLDER}/main.typ`)).toBe("= Hello\n");
    expect(ada.ports.projects.list().map((entry) => entry.kind === "ready" && entry.settings.shared)).toEqual([undefined]);
  }, 60_000);
});

describe("resuming shared projects", () => {
  it("reconnects a shared project from its stored key and drops a share whose project left", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    const { shareId } = await sharedOn(net, ada);
    await ada.ports.shares.remove(shareId);
    const resumer = createShareResumer(ada.ports, noReports());

    await net.drive(resumer.sync());
    expect(ada.open.get(shareId)?.folder).toBe(FOLDER);
    await ada.catalog.fs.writeText(`${FOLDER}/labshelf.yaml`, "id: thesis\nformat: typst\n");
    await ada.ports.projects.reload();
    await net.drive(resumer.sync());
    expect(ada.open.size).toBe(0);
  }, 60_000);

  it("reports a shared project without a stored key once", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    await ada.catalog.fs.writeText(`${FOLDER}/labshelf.yaml`, `id: thesis\nformat: typst\nshared: ${"a".repeat(32)}\n`);
    await ada.ports.projects.reload();
    const reports = noReports();
    const resumer = createShareResumer(ada.ports, reports);

    await resumer.sync();
    await resumer.sync();
    expect(reports.missingKey).toHaveBeenCalledTimes(1);
    expect(reports.failed).not.toHaveBeenCalled();
  });

  it("reports a failed reconnect once", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    const { shareId } = await sharedOn(net, ada);
    await ada.ports.shares.remove(shareId);
    ada.ports.connect = async () => { throw new Error("no disk"); };
    const reports = noReports();
    const resumer = createShareResumer(ada.ports, reports);

    await resumer.sync();
    await resumer.sync();
    expect(reports.failed).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("does not log an error when another tab runs the share", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    const { shareId } = await sharedOn(net, ada);
    await ada.ports.shares.remove(shareId);
    ada.ports.connect = async () => { throw new ShareOpenInAnotherTabError(shareId); };
    const error = jest.spyOn(ada.ports.logger, "error");

    await createShareResumer(ada.ports, noReports()).sync();
    expect(error).not.toHaveBeenCalled();
  }, 60_000);
});

describe("the invite and the owner's relay", () => {
  it("formats the invite from the relays the index lists now, else the stored ones", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    const share = await sharedOn(net, ada);
    addRelay(share.session.index, { url: TWO, addedBy: "grace" });

    const parsed = await parseInvite(await readCurrentInvite(ada.ports, share));
    expect(parsed.ok && parsed.invite.relays).toEqual([{ url: ONE }, { url: TWO }]);
    expect(ada.keys.get(share.shareId)?.relays).toEqual([{ url: ONE }, { url: TWO }]);
    share.session.index.getArray("relays").delete(0, 2);
    const fallback = await parseInvite(await readCurrentInvite(ada.ports, share));
    expect(fallback.ok && fallback.invite.relays).toEqual([{ url: ONE }, { url: TWO }]);
    await closeAll(net, ada);
  }, 60_000);

  it("withdraws only the entries this user offered, and offers again", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    const share = await sharedOn(net, ada);
    addRelay(share.session.index, { url: TWO, addedBy: "grace" });

    expect(await removeOwnRelayOffer(ada.ports, share, TWO)).toBe(false);
    expect(await removeOwnRelayOffer(ada.ports, share, ONE)).toBe(true);
    expect(readRelayList(share.session.index)).toEqual([{ url: TWO, addedBy: "grace" }]);
    expect(await offerOwnRelay(ada.ports, share)).toEqual({ kind: "offered" });
    expect(await offerOwnRelay(ada.ports, share)).toEqual({ kind: "listed" });
    expect(readRelayList(share.session.index).map((entry) => entry.url)).toEqual([TWO, ONE]);
    await closeAll(net, ada);
  }, 60_000);

  it("leaves the list as it is when the relay refuses the claim", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    const share = await sharedOn(net, ada);
    expect(await removeOwnRelayOffer(ada.ports, share, ONE)).toBe(true);
    ada.ports.fetch = async () => new Response(encodeRelayBody({ error: "not yours" }), { status: 403 });

    expect((await offerOwnRelay(ada.ports, share)).kind).toBe("refused");
    expect(readRelayList(share.session.index)).toEqual([]);
    await closeAll(net, ada);
  }, 60_000);

  it("takes the relay out of the stored invite of a share that is not connected", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    const { shareId } = await sharedOn(net, ada);
    await ada.ports.shares.remove(shareId);

    await removeOwnRelayOfferFromShares(ada.ports, ONE);
    expect(ada.keys.get(shareId)?.relays).toEqual([]);
  }, 60_000);
});
