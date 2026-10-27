// Tests the shared-project workflows: sharing, joining, leaving and resuming.
import * as Y from "yjs";
import { createShareIndexDoc, readShareIndexDocSettings, readShareIndexDocKind } from "../../src/collab/model/index";
import {
  joinShare, startShare, joinSharedProject, startProjectShare, type ShareOutcome, createShareResumer, readCurrentInvite, leaveSharedProject, offerOwnRelay, ShareOpenInAnotherTabError, removeOwnRelayOffer, removeOwnRelayOfferFromShares,
} from "../../src/share/index";
import { LIB, memoryCatalog, readText, writeTree } from "../support/memoryProjectCatalog";
import { formatInvite, parseInvite } from "../../src/collab/invite/index";
import { runFor } from "../collab/transport/relay/fakeRelay";
import { FOLDER, Network, writeProject } from "../collab/session/connectionTestbed";
import { ONE, TWO } from "../collab/relays/relayGroup";
import { closeAll, workflowDevice, type WorkflowDevice } from "./workflowTestbed";
import { addRelay, readRelayList } from "../../src/collab/relays/index";
import { encodeRelayBody } from "../../src/relay/index";

const SHARE_ID = "a".repeat(32);

function sharedIndex(settings: Record<string, unknown>): Y.Doc {
  const index = new Y.Doc();
  createShareIndexDoc(index);
  Object.entries(settings).forEach(([key, value]) => readShareIndexDocSettings(index).set(key, value));
  return index;
}

describe("startShare", () => {
  it("writes the share id into labshelf.yaml, keeping the rest and the title, and marks the index as a project's", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, "/p", { "labshelf.yaml": "# note\nid: p\nformat: typst\ntitle: Paper\n" });
    const index = new Y.Doc();
    await startShare(context, { folder: "/p", shareId: SHARE_ID, index });
    expect(readText(context.fs, "/p/labshelf.yaml")).toBe(`# note\nid: p\nformat: typst\ntitle: Paper\nshared: ${SHARE_ID}\n`);
    expect(readShareIndexDocKind(index)).toEqual({ ok: true, kind: "project" });
  });

  it("writes the id as the title of a project without one, so a joiner's copy takes the owner's name", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, "/p", { "labshelf.yaml": "id: deep-survey\nformat: typst\n" });
    await startShare(context, { folder: "/p", shareId: SHARE_ID, index: new Y.Doc() });
    expect(readText(context.fs, "/p/labshelf.yaml")).toBe(`id: deep-survey\nformat: typst\ntitle: deep-survey\nshared: ${SHARE_ID}\n`);
  });
});

describe("joinShare", () => {
  it("creates projects/<id>/ named by the shared title with the shared settings and the local keys", async () => {
    const context = memoryCatalog();
    const index = sharedIndex({ format: "typst", main: "main.typ", title: "Deep Survey" });
    const joined = await joinShare(context, { libraryRoot: LIB, shareId: SHARE_ID, index });
    expect(joined).toEqual({ id: "deep-survey", folder: `${LIB}/projects/deep-survey` });
    expect(readText(context.fs, `${joined.folder}/labshelf.yaml`)).toBe(
      `id: deep-survey\nshared: ${SHARE_ID}\nformat: typst\nmain: main.typ\ntitle: Deep Survey\n`,
    );
  });

  it("takes the usual suffix when the id is taken", async () => {
    const context = memoryCatalog();
    await writeTree(context.fs, `${LIB}/projects/deep-survey`, { "labshelf.yaml": "id: deep-survey\nformat: typst\n" });
    const joined = await joinShare(context, { libraryRoot: LIB, shareId: SHARE_ID, index: sharedIndex({ format: "typst", title: "Deep Survey" }) });
    expect(joined.id).not.toBe("deep-survey");
    expect(joined.id.startsWith("deep-survey")).toBe(true);
  });

  it("refuses a share that is not a project", async () => {
    const index = new Y.Doc();
    index.getMap("share").set("kind", "notebook");
    await expect(joinShare(memoryCatalog(), { libraryRoot: LIB, shareId: SHARE_ID, index })).rejects.toThrow(/notebook/);
    await expect(joinShare(memoryCatalog(), { libraryRoot: LIB, shareId: SHARE_ID, index: new Y.Doc() })).rejects.toThrow(/kind/);
  });
});

const never = () => new AbortController().signal;

async function shared(net: Network, ada: WorkflowDevice): Promise<Extract<ShareOutcome, { kind: "shared" }>> {
  await writeProject(ada);
  await ada.ports.projects.reload();
  const outcome = await net.drive(startProjectShare(ada.ports, { folder: FOLDER, shared: undefined, signal: never() }));
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

    await expect(net.drive(startProjectShare(ada.ports, { folder: FOLDER, shared: undefined, signal: cancel.signal }))).rejects.toThrow(/cancelled/);
    expect(ada.keys.size).toBe(0);
    expect(ada.open.size).toBe(0);
    expect(ada.states.size).toBe(0);
    expect(ada.read(`${FOLDER}/labshelf.yaml`)).toBe("id: thesis\ntitle: Thesis\nformat: typst\nmain: main.typ\n");
  }, 60_000);

  it("rolls back the shared field a share wrote when the mirror fails to start after placing the project", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada", async () => { throw new Error("the mirror could not start"); });
    await writeProject(ada);

    await expect(net.drive(startProjectShare(ada.ports, { folder: FOLDER, shared: undefined, signal: never() }))).rejects.toThrow("mirror");
    expect(ada.keys.size).toBe(0);
    expect(ada.open.size).toBe(0);
    expect(ada.read(`${FOLDER}/labshelf.yaml`)).toBe("id: thesis\ntitle: Thesis\nformat: typst\nmain: main.typ\n");
  }, 60_000);

  it("rolls back a new share and reports the error when the owner's relay refuses the claim", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    await writeProject(ada);
    ada.ports.fetch = async () => { throw new TypeError("fetch failed"); };

    await expect(net.drive(startProjectShare(ada.ports, { folder: FOLDER, shared: undefined, signal: never() }))).rejects.toThrow(/relay/);
    expect(ada.keys.size).toBe(0);
    expect(ada.open.size).toBe(0);
    expect(ada.states.size).toBe(0);
    expect(ada.read(`${FOLDER}/labshelf.yaml`)).toBe("id: thesis\ntitle: Thesis\nformat: typst\nmain: main.typ\n");
  }, 60_000);

  it("leaves the labshelf.yaml of an untitled project byte-identical when a new share rolls back", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    await writeProject(ada);
    const untitled = "id: thesis\n# kept\nformat: typst\nmain: main.typ\n";
    await ada.catalog.fs.writeText(`${FOLDER}/labshelf.yaml`, untitled);
    ada.ports.fetch = async () => { throw new TypeError("fetch failed"); };

    await expect(net.drive(startProjectShare(ada.ports, { folder: FOLDER, shared: undefined, signal: never() }))).rejects.toThrow(/relay/);
    expect(ada.read(`${FOLDER}/labshelf.yaml`)).toBe(untitled);
  }, 60_000);

  it("publishes nothing when no relay gets connected", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    await writeProject(ada);
    ada.ports.relay = { get: async () => undefined };
    const requireRelay = jest.fn(async () => false);
    ada.ports.requireRelay = requireRelay;
    const connect = jest.spyOn(ada.ports, "connect");

    expect(await startProjectShare(ada.ports, { folder: FOLDER, shared: undefined, signal: never() })).toEqual({ kind: "noRelay" });
    expect(requireRelay).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
    expect(ada.keys.size).toBe(0);
  });

  it("re-copies the invite of a shared project from its stored key, reconnecting it first", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    const { connection } = await shared(net, ada);
    await ada.ports.shares.remove(connection.shareId);

    const again = await net.drive(startProjectShare(ada.ports, { folder: FOLDER, shared: connection.shareId, signal: never() }));
    expect(again.kind).toBe("shared");
    expect(ada.open.has(connection.shareId)).toBe(true);
    ada.keys.clear();
    await ada.ports.shares.remove(connection.shareId);
    expect(await startProjectShare(ada.ports, { folder: FOLDER, shared: connection.shareId, signal: never() })).toEqual({ kind: "noKey" });
    await closeAll(net, ada);
  }, 60_000);
});

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
