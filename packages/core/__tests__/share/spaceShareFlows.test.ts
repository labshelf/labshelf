// Tests the shared-Space workflows end to end: sharing a Space, joining it from its invite on another device, and leaving it.
import { readShareIndexDocKind } from "../../src/collab/index";
import { joinSharedProject, leaveSharedSpace, startSpaceShare } from "../../src/share/index";
import { LIB, readText, writeTree } from "../support/memoryProjectCatalog";
import { runFor } from "../collab/relays/fakeRelay";
import { Network } from "../collab/session/connectionTestbed";
import { closeAll, workflowDevice } from "./workflowTestbed";

const FOLDER = `${LIB}/spaces/reading`;
const never = () => new AbortController().signal;

const spaceFile = `${JSON.stringify({
  version: 1, name: "Reading group", purpose: "Transformers", icon: "brain",
  folders: [{ id: "f1", name: "Core" }], papers: [{ id: "vaswani2017attention", folder: "f1", focus: true }], projects: [], dates: [],
}, null, 2)}\n`;

describe("sharing and joining a Space", () => {
  it("gives the joiner the Space under its shared name with its notes, and leaving keeps the files", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    const grace = workflowDevice(net, "grace");
    await writeTree(ada.catalog.fs, FOLDER, { "space.json": spaceFile, "notes/plan.qmd": "::: {#a1}\n# Plan\n:::\n" });
    await ada.ports.spaces!.reload();

    const outcome = await net.drive(startSpaceShare(ada.ports, { folder: FOLDER, shared: undefined, signal: never() }));
    if (outcome.kind !== "shared") { throw new Error(`not shared: ${outcome.kind}`); }
    await net.drive(outcome.connection.mirror!.idle());
    await runFor(net.clock, 5000);
    expect(outcome.connection.kind).toBe("space");
    expect(readShareIndexDocKind(outcome.connection.session.index)).toEqual({ ok: true, kind: "space" });
    expect(JSON.parse(readText(ada.catalog.fs, `${FOLDER}/space.json`)).shared).toBe(outcome.connection.shareId);
    expect(ada.ports.spaces!.list()[0]?.shared).toBe(outcome.connection.shareId);

    const joined = await net.drive(joinSharedProject(grace.ports, outcome.invite, never()));
    expect(joined).toEqual({ kind: "joined", folder: `${LIB}/spaces/reading-group`, place: "space" });
    const joinedFolder = `${LIB}/spaces/reading-group`;
    await runFor(net.clock, 5000);
    await net.drive(grace.open.get(outcome.connection.shareId)!.mirror!.idle());
    const space = JSON.parse(readText(grace.catalog.fs, `${joinedFolder}/space.json`));
    expect(space).toMatchObject({ name: "Reading group", purpose: "Transformers", shared: outcome.connection.shareId });
    expect(space.icon).toBeUndefined();
    expect(space.papers).toEqual([{ id: "vaswani2017attention", folder: "f1" }]);
    expect(readText(grace.catalog.fs, `${joinedFolder}/notes/plan.qmd`)).toContain("# Plan");
    expect(grace.projectFolders()).toEqual([]);

    await net.drive(leaveSharedSpace(grace.ports, { folder: joinedFolder, shareId: outcome.connection.shareId }));
    expect(JSON.parse(readText(grace.catalog.fs, `${joinedFolder}/space.json`)).shared).toBeUndefined();
    expect(readText(grace.catalog.fs, `${joinedFolder}/notes/plan.qmd`)).toContain("# Plan");
    expect(grace.keys.has(outcome.connection.shareId)).toBe(false);
    await closeAll(net, ada, grace);
  });
});
