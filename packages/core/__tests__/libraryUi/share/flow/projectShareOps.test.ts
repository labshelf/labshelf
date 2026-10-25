import type { ShareConnection, ShareConnectionState } from "../../../../src/collab/session";
import { joinSharedProject, leaveSharedProject, shareProject, type ShareWorkflowPorts } from "../../../../src/collab/share/flows";
import { createProjectSharingOps } from "../../../../src/libraryUi/share/flow";
import type { ILogger } from "../../../../src/ports";
import type { ProjectEntry, ProjectSettings } from "../../../../src/writing/project";

jest.mock("../../../../src/collab/share/flows", () => ({
  ...jest.requireActual("../../../../src/collab/share/flows"),
  shareProject: jest.fn(), joinSharedProject: jest.fn(), leaveSharedProject: jest.fn(), currentInvite: jest.fn(),
}));

const UNKNOWN = "This project is not in the open library.";

function ready(folder: string, settings: Partial<ProjectSettings> = {}): ProjectEntry {
  return { kind: "ready", folder, location: "library", main: undefined, settings: { id: folder, format: "latex", ...settings } as ProjectSettings };
}

function connection(state: Partial<ShareConnectionState>): ShareConnection {
  const full: ShareConnectionState = { status: "open", relay: undefined, persistenceFailure: undefined, mirror: { kind: "running" }, ...state };
  return { shareId: "s1", folder: "/p/shared", state: () => full } as unknown as ShareConnection;
}

function setup(entries: ProjectEntry[], active: Record<string, ShareConnection> = {}, busy = false) {
  const list = [...entries];
  const ports = {
    projects: { list: () => list, reload: async () => {} },
    shares: { active: (id: string) => active[id], isBusy: () => busy },
  } as unknown as ShareWorkflowPorts;
  const lines: unknown[][] = [];
  const logger: ILogger = { log: async (...a) => { lines.push(a); }, error: async (...a) => { lines.push(a); } };
  const open = jest.fn(async () => {});
  const ops = createProjectSharingOps({ ports, idOf: (e) => e.folder, open }, logger);
  return { ops, list, lines, open };
}

const signal = new AbortController().signal;

beforeEach(() => jest.clearAllMocks());

describe("createProjectSharingOps", () => {
  it("rejects actions on an unknown id and reports it ineligible", async () => {
    const { ops, lines } = setup([ready("/p/a")]);
    await expect(ops.shareProject("/p/x", signal)).rejects.toThrow(UNKNOWN);
    await expect(ops.openProject("/p/x")).rejects.toThrow(UNKNOWN);
    await expect(ops.projectStatus("/p/x")).resolves.toEqual({ kind: "ineligible", reason: UNKNOWN });
    expect(lines.length).toBeGreaterThan(0);
  });

  it("refuses to share a trashed project", async () => {
    const { ops } = setup([ready("/p/t", { trashed: "2026-01-01" })]);
    await expect(ops.shareProject("/p/t", signal)).rejects.toThrow("This project is in the trash.");
    expect(shareProject).not.toHaveBeenCalled();
  });

  it("maps a share outcome without its connection", async () => {
    const { ops } = setup([ready("/p/a")]);
    (shareProject as jest.Mock).mockResolvedValue({ kind: "shared", invite: "inv", connection: {}, offer: {} });
    await expect(ops.shareProject("/p/a", signal)).resolves.toEqual({ kind: "shared", invite: "inv" });
    expect(shareProject).toHaveBeenCalledWith(expect.anything(), { folder: "/p/a", shared: undefined, signal });
  });

  it("rejects leaving an unshared project without calling the workflow", async () => {
    const { ops } = setup([ready("/p/a")]);
    await expect(ops.leaveProject("/p/a")).rejects.toThrow();
    expect(leaveSharedProject).not.toHaveBeenCalled();
  });

  it("rejects a share while the share is busy", async () => {
    const { ops } = setup([ready("/p/s", { shared: "s1" })], {}, true);
    await expect(ops.shareProject("/p/s", signal)).rejects.toThrow("This shared project is busy; try again in a moment.");
    expect(shareProject).not.toHaveBeenCalled();
  });

  it("maps the share status", async () => {
    const entries = [ready("/p/a"), ready("/p/s", { shared: "s1" }), ready("/p/b", { trashed: "x" })];
    const open = setup(entries, { s1: connection({}) });
    await expect(open.ops.projectStatus("/p/a")).resolves.toEqual({ kind: "notShared" });
    await expect(open.ops.projectStatus("/p/s")).resolves.toEqual({ kind: "shared", connected: true });
    await expect(open.ops.projectStatus("/p/b")).resolves.toEqual({ kind: "ineligible", reason: "This project is in the trash." });
    const failing = setup(entries, { s1: connection({ status: "closed", persistenceFailure: "disk full", mirror: { kind: "busy", holder: "tab" } }) });
    await expect(failing.ops.projectStatus("/p/s")).resolves.toEqual({ kind: "shared", connected: false, problem: "disk full" });
    const busy = setup(entries, { s1: connection({ mirror: { kind: "busy", holder: { app: "vscode", renewedAt: 1 } } }) });
    await expect(busy.ops.projectStatus("/p/s")).resolves.toMatchObject({ problem: expect.stringMatching(/^VS Code mirrors/) });
    const none = setup(entries);
    await expect(none.ops.projectStatus("/p/s")).resolves.toEqual({ kind: "shared", connected: false });
  });

  it("lists ready, untrashed projects with their shared flag", async () => {
    const broken: ProjectEntry = { kind: "broken", folder: "/p/bad", location: "library", reason: "x" };
    const { ops } = setup([ready("/p/a", { title: "Alpha" }), ready("/p/s", { shared: "s1" }), ready("/p/t", { trashed: "x" }), broken]);
    await expect(ops.projects()).resolves.toEqual([
      { id: "/p/a", name: "Alpha", shared: false },
      { id: "/p/s", name: "/p/s", shared: true },
    ]);
  });

  it("maps a joined folder to the host id and name", async () => {
    const { ops, list } = setup([]);
    (joinSharedProject as jest.Mock).mockImplementation(async () => {
      list.push(ready("/p/j", { title: "Joined", shared: "s1" }));
      return { kind: "joined", folder: "/p/j" };
    });
    await expect(ops.joinProject("inv", signal)).resolves.toEqual({ kind: "joined", id: "/p/j", name: "Joined" });
  });

  it("passes a refused join through", async () => {
    const { ops } = setup([]);
    (joinSharedProject as jest.Mock).mockResolvedValue({ kind: "refused", problem: "bad invite" });
    await expect(ops.joinProject("inv", signal)).resolves.toEqual({ kind: "refused", problem: "bad invite" });
  });

  it("rejects a join whose project is missing from the list", async () => {
    const { ops } = setup([]);
    (joinSharedProject as jest.Mock).mockResolvedValue({ kind: "joined", folder: "/p/gone" });
    await expect(ops.joinProject("inv", signal)).rejects.toThrow();
  });

  it("opens a known project", async () => {
    const { ops, open } = setup([ready("/p/a")]);
    await ops.openProject("/p/a");
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ folder: "/p/a" }));
  });
});
