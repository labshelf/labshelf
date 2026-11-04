// Tests what runs beside a connected Space share: its linked projects are shared and reach every member, linked there too.
import { attachSpaceShare, startSpaceShare, joinSharedProject, type SpaceShareDeps } from "../../src/share/index";
import { SpaceStore } from "../../src/spaces/index";
import { LIB, readText, writeTree } from "../support/memoryProjectCatalog";
import { runFor } from "../collab/relays/fakeRelay";
import { Network, writeProject } from "../collab/session/connectionTestbed";
import { closeAll, workflowDevice, type WorkflowDevice } from "./workflowTestbed";

const never = () => new AbortController().signal;

function deps(device: WorkflowDevice): SpaceShareDeps {
  const spaces = new SpaceStore({ root: LIB, fs: device.catalog.fs, paths: device.catalog.paths, logger: device.catalog.logger });
  return {
    ports: device.ports, spaces, papers: () => new Map(), onPapersChange: () => () => undefined,
    onProjectsChange: () => () => undefined, readPdf: async () => undefined,
  };
}

describe("the projects of a shared Space", () => {
  it("shares a linked project with its invite in the index, and the member's device joins it from there", async () => {
    const net = new Network();
    const ada = workflowDevice(net, "ada");
    const grace = workflowDevice(net, "grace");
    await writeProject(ada);
    await ada.ports.projects.reload();
    await writeTree(ada.catalog.fs, `${LIB}/spaces/reading`, {
      "space.json": `${JSON.stringify({ version: 1, name: "Reading", folders: [], papers: [], projects: ["thesis"], dates: [] }, null, 2)}\n`,
    });
    await ada.ports.spaces!.reload();
    const outcome = await net.drive(startSpaceShare(ada.ports, { folder: `${LIB}/spaces/reading`, shared: undefined, signal: never() }));
    if (outcome.kind !== "shared") { throw new Error(`not shared: ${outcome.kind}`); }
    const adaDeps = deps(ada);
    const stopAda = attachSpaceShare(outcome.connection, adaDeps);
    await runFor(net.clock, 5000);
    const projects = outcome.connection.session.index.getMap("projects");
    expect(projects.size).toBe(1);
    const projectShareId = [...projects.keys()][0]!;
    expect(readText(ada.catalog.fs, `${LIB}/projects/thesis/labshelf.yaml`)).toContain(`shared: ${projectShareId}`);

    const joined = await net.drive(joinSharedProject(grace.ports, outcome.invite, never()));
    if (joined.kind === "refused") { throw new Error(joined.problem); }
    await runFor(net.clock, 5000);
    // The in-process relay plays one share per host, so the project's join is seen at the connect port, not run to the end.
    const starts: { shareId: string; mode: string }[] = [];
    const connect = grace.ports.connect;
    grace.ports.connect = (invite, start) => { starts.push({ shareId: invite.shareId, mode: start.mode }); return connect(invite, start); };
    const stopGrace = attachSpaceShare(grace.open.get(outcome.connection.shareId)!, deps(grace));
    await runFor(net.clock, 5000);
    expect(starts).toContainEqual({ shareId: projectShareId, mode: "join" });
    stopAda();
    stopGrace();
    await closeAll(net, ada, grace);
  });
});
