// Tests the sharing host over the core workflows: the host, folder link ops, project ops and store failure notices.
import type { ILogger } from "../../src/ports/index";
import {
  createStoreFailureNotices, createShareHost, type ImportShareLinkResult, createFolderShareLinkOps, type FolderShareLinkDeps, joinSharedProject, leaveSharedProject, startProjectShare, type ShareFlowPorts, createProjectShareOps,
} from "../../src/share/index";
import { posixPathOps } from "../../src/path/index";
import type { PaperRecord } from "../../src/model/index";
import type { RelayAccount } from "../../src/relay/index";
import type { ShareProgress } from "../../src/share/libraryShareHost";
import { makeHarness, PAPERS } from "../support/mutationHarness";
import { memoryShareRegistry, memoryShareRelay } from "../support/memoryShareRelay";
import type { ShareConnection, ShareConnectionState } from "../../src/collab/session";
import type { ProjectEntry, ProjectSettings } from "../../src/writing/project";

const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;

function host(write: (text: string) => Promise<void> = async () => undefined) {
  const openLink = jest.fn(async () => undefined);
  return { openLink, sharing: createShareHost({ place: "this device", logger, clipboard: { write }, openLink }) };
}

describe("createSharingHost", () => {
  it("offers neither half and refuses their operations when the app runs none", async () => {
    const { sharing } = host();
    expect(sharing.offers()).toEqual({ projects: false, links: false });
    await expect(sharing.shareProject("p", new AbortController().signal)).rejects.toThrow("does not share projects");
    await expect(sharing.sharedLinks()).rejects.toThrow("does not share folders");
  });

  it("answers false when the clipboard refuses the copy", async () => {
    const { sharing } = host(async () => { throw new Error("denied"); });
    await expect(sharing.copyText("x")).resolves.toBe(false);
    await expect(host().sharing.copyText("x")).resolves.toBe(true);
  });

  it("opens only web links", async () => {
    const { sharing, openLink } = host();
    await expect(sharing.openLink("javascript:alert(1)")).rejects.toThrow("only web links");
    await sharing.openLink("https://share.example/share/#k");
    expect(openLink).toHaveBeenCalledTimes(1);
  });
});

const account = { relayUrl: "https://relay.someone.workers.dev" } as RelayAccount;

function record(id: string, folder: string): PaperRecord {
  return { id, citeKey: id, title: `Title ${id}`, path: `${PAPERS}/${folder}/${id}` } as PaperRecord;
}

async function setup(overrides: Partial<FolderShareLinkDeps> = {}) {
  const h = makeHarness();
  const papers = [record("a", "Group"), record("b", "Group/Week 1")];
  for (const paper of papers) { await h.seedPaper(paper.path, { title: paper.title }); }
  const relay = memoryShareRelay();
  const opened: string[] = [];
  let refreshes = 0;
  const deps: FolderShareLinkDeps = {
    papers: () => papers, papersRoot: PAPERS, sep: "/",
    sources: { fs: h.fs, paths: posixPathOps, annotations: async () => [] },
    registry: memoryShareRegistry(),
    relay: { require: async () => account, connected: async () => account },
    backendFor: () => () => relay.backend,
    readerFor: () => relay.reader,
    importLink: async () => ({ status: "refused", error: "bad" }),
    refresh: async () => { refreshes += 1; },
    openFolder: async (path) => { opened.push(path); },
    ...overrides,
  };
  return { ops: createFolderShareLinkOps(deps, h.ctx.logger), relay, opened, refreshes: () => refreshes };
}

describe("createFolderLinkOps", () => {
  it("refuses a folder that holds no papers, without uploading", async () => {
    const { ops, relay } = await setup();
    expect(await ops.shareableFolder(`${PAPERS}/Empty`)).toBeUndefined();
    expect(await ops.shareableFolder(PAPERS)).toBeUndefined();
    await expect(ops.shareFolder(`${PAPERS}/Empty`, false, () => undefined)).rejects.toThrow("This folder holds no papers to share.");
    expect(relay.manifests.size).toBe(0);
  });

  it("answers noRelay when no relay is connected", async () => {
    const { ops, relay } = await setup({ relay: { require: async () => undefined, connected: async () => undefined } });
    expect(await ops.shareFolder(`${PAPERS}/Group`, false, () => undefined)).toEqual({ kind: "noRelay" });
    expect(relay.manifests.size).toBe(0);
  });

  it("shares an eligible folder, reports its stages and lists the link", async () => {
    const { ops } = await setup();
    expect(await ops.shareableFolder(`${PAPERS}/Group`)).toEqual({ path: `${PAPERS}/Group`, label: "Group", count: 2 });
    const progress: ShareProgress[] = [];
    const result = await ops.shareFolder(`${PAPERS}/Group`, false, (p) => progress.push(p));
    expect(result.kind).toBe("shared");
    expect(progress).toEqual([{ stage: "reading" }, { stage: "encrypting" }, { stage: "uploading" }]);
    const links = await ops.sharedLinks();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ folder: "Group", relayHost: "relay.someone.workers.dev" });
    expect(result.kind === "shared" && links[0]?.link).toBe(result.kind === "shared" && result.link);
  });

  it("revokes a listed link once", async () => {
    const { ops, relay } = await setup();
    await ops.shareFolder(`${PAPERS}/Group`, false, () => undefined);
    const [link] = await ops.sharedLinks();
    expect(await ops.revokeLink(link!.id)).toBe(true);
    expect(relay.manifests.size).toBe(0);
    expect(await ops.revokeLink(link!.id)).toBe(false);
    expect(await ops.sharedLinks()).toEqual([]);
  });

  it("words a refused or unopenable link as a failure", async () => {
    const refused = await setup();
    expect(await refused.ops.importLink("x", () => undefined)).toEqual({ kind: "failed", message: "LabShelf could not read that share link. (bad)" });
    const removed = await setup({ importLink: async () => ({ status: "openFailed", error: "removed" }) });
    expect(await removed.ops.importLink("x", () => undefined)).toEqual({ kind: "failed", message: "This link was removed by the person who shared it." });
    expect(refused.refreshes() + removed.refreshes()).toBe(0);
  });

  it("refreshes after an import that added papers and reports progress", async () => {
    const summary = { folder: `${PAPERS}/Group 2`, added: [record("c", "Group 2")], duplicates: [], missingPdfs: [] };
    const result: ImportShareLinkResult = { status: "imported", summary, withAnnotations: false };
    const s = await setup({ importLink: async ({ onProgress }) => { onProgress?.(1, 1); return result; } });
    const progress: ShareProgress[] = [];
    expect(await s.ops.importLink("x", (p) => progress.push(p))).toEqual({
      kind: "imported", summary: 'Imported 1 of the shared papers into "Group 2".', folder: `${PAPERS}/Group 2`,
    });
    expect(progress).toEqual([{ done: 1, total: 1 }]);
    expect(s.refreshes()).toBe(1);
  });

  it("does not refresh when every shared paper was already there", async () => {
    const summary = { added: [], duplicates: [{ title: "T", existingId: "a" }], missingPdfs: [] };
    const s = await setup({ importLink: async () => ({ status: "imported", summary, withAnnotations: false }) });
    expect(await s.ops.importLink("x", () => undefined)).toEqual({ kind: "imported", summary: "Every shared paper is already in your library.", folder: undefined });
    expect(s.refreshes()).toBe(0);
  });

  it("opens folders of the library only", async () => {
    const { ops, opened } = await setup();
    await ops.openFolder(PAPERS);
    await ops.openFolder(`${PAPERS}/Group`);
    await expect(ops.openFolder("/etc")).rejects.toThrow();
    await expect(ops.openFolder(`${PAPERS}-other`)).rejects.toThrow();
    expect(opened).toEqual([PAPERS, `${PAPERS}/Group`]);
  });
});

jest.mock("../../src/share/projectShareFlows", () => ({
  ...jest.requireActual("../../src/share/projectShareFlows"),
  startProjectShare: jest.fn(), joinSharedProject: jest.fn(), leaveSharedProject: jest.fn(),
}));
jest.mock("../../src/share/sharedProjects", () => ({
  ...jest.requireActual("../../src/share/sharedProjects"),
  readCurrentInvite: jest.fn(),
}));

const UNKNOWN = "This project is not in the open library.";

function ready(folder: string, settings: Partial<ProjectSettings> = {}): ProjectEntry {
  return { kind: "ready", folder, location: "library", main: undefined, settings: { id: folder, format: "latex", ...settings } as ProjectSettings };
}

function connection(state: Partial<ShareConnectionState>): ShareConnection {
  const full: ShareConnectionState = { status: "open", relay: undefined, persistenceFailure: undefined, mirror: { kind: "running" }, ...state };
  return { shareId: "s1", folder: "/p/shared", state: () => full } as unknown as ShareConnection;
}

function setupProjectShareOps(entries: ProjectEntry[], active: Record<string, ShareConnection> = {}, busy = false) {
  const list = [...entries];
  const ports = {
    projects: { list: () => list, reload: async () => {} },
    shares: { active: (id: string) => active[id], isBusy: () => busy },
  } as unknown as ShareFlowPorts;
  const lines: unknown[][] = [];
  const logger: ILogger = { log: async (...a) => { lines.push(a); }, error: async (...a) => { lines.push(a); } };
  const open = jest.fn(async () => {});
  const ops = createProjectShareOps({ ports, idOf: (e) => e.folder, open }, logger);
  return { ops, list, lines, open };
}

const signal = new AbortController().signal;

beforeEach(() => jest.clearAllMocks());

describe("createProjectSharingOps", () => {
  it("rejects actions on an unknown id and reports it ineligible", async () => {
    const { ops, lines } = setupProjectShareOps([ready("/p/a")]);
    await expect(ops.shareProject("/p/x", signal)).rejects.toThrow(UNKNOWN);
    await expect(ops.openProject("/p/x")).rejects.toThrow(UNKNOWN);
    await expect(ops.projectStatus("/p/x")).resolves.toEqual({ kind: "ineligible", reason: UNKNOWN });
    expect(lines.length).toBeGreaterThan(0);
  });

  it("refuses to share a trashed project", async () => {
    const { ops } = setupProjectShareOps([ready("/p/t", { trashed: "2026-01-01" })]);
    await expect(ops.shareProject("/p/t", signal)).rejects.toThrow("This project is in the trash.");
    expect(startProjectShare).not.toHaveBeenCalled();
  });

  it("maps a share outcome without its connection", async () => {
    const { ops } = setupProjectShareOps([ready("/p/a")]);
    (startProjectShare as jest.Mock).mockResolvedValue({ kind: "shared", invite: "inv", connection: {}, offer: {} });
    await expect(ops.shareProject("/p/a", signal)).resolves.toEqual({ kind: "shared", invite: "inv" });
    expect(startProjectShare).toHaveBeenCalledWith(expect.anything(), { folder: "/p/a", shared: undefined, signal });
  });

  it("rejects leaving an unshared project without calling the workflow", async () => {
    const { ops } = setupProjectShareOps([ready("/p/a")]);
    await expect(ops.leaveProject("/p/a")).rejects.toThrow();
    expect(leaveSharedProject).not.toHaveBeenCalled();
  });

  it("rejects a share while the share is busy", async () => {
    const { ops } = setupProjectShareOps([ready("/p/s", { shared: "s1" })], {}, true);
    await expect(ops.shareProject("/p/s", signal)).rejects.toThrow("This shared project is busy; try again in a moment.");
    expect(startProjectShare).not.toHaveBeenCalled();
  });

  it("maps the share status", async () => {
    const entries = [ready("/p/a"), ready("/p/s", { shared: "s1" }), ready("/p/b", { trashed: "x" })];
    const open = setupProjectShareOps(entries, { s1: connection({}) });
    await expect(open.ops.projectStatus("/p/a")).resolves.toEqual({ kind: "notShared" });
    await expect(open.ops.projectStatus("/p/s")).resolves.toEqual({ kind: "shared", connected: true });
    await expect(open.ops.projectStatus("/p/b")).resolves.toEqual({ kind: "ineligible", reason: "This project is in the trash." });
    const failing = setupProjectShareOps(entries, { s1: connection({ status: "closed", persistenceFailure: "disk full", mirror: { kind: "busy", holder: "tab" } }) });
    await expect(failing.ops.projectStatus("/p/s")).resolves.toEqual({ kind: "shared", connected: false, problem: "disk full" });
    const busy = setupProjectShareOps(entries, { s1: connection({ mirror: { kind: "busy", holder: { app: "vscode", renewedAt: 1 } } }) });
    await expect(busy.ops.projectStatus("/p/s")).resolves.toMatchObject({ problem: expect.stringMatching(/^VS Code mirrors/) });
    const none = setupProjectShareOps(entries);
    await expect(none.ops.projectStatus("/p/s")).resolves.toEqual({ kind: "shared", connected: false });
  });

  it("lists ready, untrashed projects with their shared flag", async () => {
    const broken: ProjectEntry = { kind: "broken", folder: "/p/bad", location: "library", reason: "x" };
    const { ops } = setupProjectShareOps([ready("/p/a", { title: "Alpha" }), ready("/p/s", { shared: "s1" }), ready("/p/t", { trashed: "x" }), broken]);
    await expect(ops.projects()).resolves.toEqual([
      { id: "/p/a", name: "Alpha", shared: false },
      { id: "/p/s", name: "/p/s", shared: true },
    ]);
  });

  it("maps a joined folder to the host id and name", async () => {
    const { ops, list } = setupProjectShareOps([]);
    (joinSharedProject as jest.Mock).mockImplementation(async () => {
      list.push(ready("/p/j", { title: "Joined", shared: "s1" }));
      return { kind: "joined", folder: "/p/j" };
    });
    await expect(ops.joinProject("inv", signal)).resolves.toEqual({ kind: "joined", id: "/p/j", name: "Joined" });
  });

  it("passes a refused join through", async () => {
    const { ops } = setupProjectShareOps([]);
    (joinSharedProject as jest.Mock).mockResolvedValue({ kind: "refused", problem: "bad invite" });
    await expect(ops.joinProject("inv", signal)).resolves.toEqual({ kind: "refused", problem: "bad invite" });
  });

  it("rejects a join whose project is missing from the list", async () => {
    const { ops } = setupProjectShareOps([]);
    (joinSharedProject as jest.Mock).mockResolvedValue({ kind: "joined", folder: "/p/gone" });
    await expect(ops.joinProject("inv", signal)).rejects.toThrow();
  });

  it("opens a known project", async () => {
    const { ops, open } = setupProjectShareOps([ready("/p/a")]);
    await ops.openProject("/p/a");
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ folder: "/p/a" }));
  });
});

function setupStoreErrorNotices() {
  let failure: string | undefined;
  const share = { shareId: "s1", folder: "/lib/thesis", state: () => ({ persistenceFailure: failure }) } as unknown as ShareConnection;
  const shares: ShareConnection[] = [share];
  const entry = { kind: "ready", folder: "/lib/thesis", settings: { id: "thesis", title: "My Thesis" } } as unknown as ProjectEntry;
  const notify = jest.fn();
  const check = createStoreFailureNotices({ shares: { list: () => shares } as never, projects: { list: () => [entry] } as never }, "page", notify);
  return { check, notify, shares, fail: (reason: string | undefined) => { failure = reason; check(); } };
}

describe("persistenceFailureNotices", () => {
  it("notifies once when a failure appears, naming the project and the reason", () => {
    const { notify, fail } = setupStoreErrorNotices();
    fail("QuotaExceededError");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      `Edits to "My Thesis" cannot be stored on this device: QuotaExceededError. Keep this page open until it is fixed; the other members still receive your edits while you are connected.`,
    );
  });

  it("does not notify again while the failure lasts, nor when it clears", () => {
    const { notify, fail, check } = setupStoreErrorNotices();
    fail("QuotaExceededError");
    fail("QuotaExceededError");
    fail("another write failed");
    check();
    fail(undefined);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("notifies a failure after a clear as a new episode", () => {
    const { notify, fail } = setupStoreErrorNotices();
    fail("QuotaExceededError");
    fail(undefined);
    fail("QuotaExceededError");
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("does not notify while no failure was seen", () => {
    const { notify, check } = setupStoreErrorNotices();
    check();
    expect(notify).not.toHaveBeenCalled();
  });
});
