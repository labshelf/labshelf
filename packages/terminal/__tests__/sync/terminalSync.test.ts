import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { PaperDataStore, ReauthRequiredError, type SyncLockInfo, type SyncRunRecord } from "@labshelf/core";
import { createNodeSidecarPort } from "@labshelf/core/node";
import { MemoryTokenStore } from "@labshelf/core/test-support/sync-fakes";
import { stringify } from "yaml";

import { FakeRemoteProvider } from "../fixtures/fakeRemote";
import { cleanupTempDirs, listFiles, pathExists, readYaml, type PaperFixture } from "../fixtures/library";
import { device, expectSynced, type Device } from "../fixtures/syncDevice";

afterEach(async () => {
  await cleanupTempDirs();
});

const ID = "vaswani2017attention";
const TITLE = "Attention Is All You Need";

const PAPER: PaperFixture = {
  id: ID,
  collection: "ML",
  title: TITLE,
  pdf: true,
  bib: true,
  meta: { authors: ["Ashish Vaswani"], year: 2017, status: "reading" },
  sidecar: { annotations: [], theme: "dark" },
};

const RECORD: SyncRunRecord = {
  providerId: "google-drive", app: "vscode", host: "laptop", startedAt: "2025-05-01T10:00:00.000Z", finishedAt: "2025-05-01T10:00:05.000Z",
  uploaded: 1, downloaded: 2, deletedLocal: 0, deletedRemote: 0, conflicts: [],
};

function lockInfo(overrides: Partial<SyncLockInfo> = {}): SyncLockInfo {
  const now = new Date().toISOString();
  return { app: "vscode", pid: 424242, host: "other-host", token: "foreign-token", acquiredAt: now, heartbeatAt: now, ...overrides };
}

async function writeLock(d: Device, content: SyncLockInfo): Promise<void> {
  await fs.mkdir(d.lib.paths.layout.syncDir(), { recursive: true });
  await fs.writeFile(d.lib.paths.layout.lockPath(), JSON.stringify(content, null, 2));
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

describe("terminal sync: init with the CLI Drive auth", () => {
  it("is idle with a client and tokens, disconnected without tokens, unconfigured without a client", async () => {
    expect((await device()).sync.status().state).toBe("idle");
    expect((await device({ tokens: new MemoryTokenStore() })).sync.status().state).toBe("disconnected");
    expect((await device({ client: undefined })).sync.status().state).toBe("unconfigured");
  });

  it("reads the last-run record written by another app, and ignores a corrupt one", async () => {
    const shared = await device({ prepare: (lib) => fs.writeFile(lib.paths.layout.lastRunPath(), JSON.stringify(RECORD)) });
    expect(shared.sync.status().lastRun).toEqual(RECORD);
    const corrupt = await device({ prepare: (lib) => fs.writeFile(lib.paths.layout.lastRunPath(), "{ broken") });
    expect(corrupt.sync.status().lastRun).toBeUndefined();
  });
});

describe("terminal sync: one device", () => {
  it("names the Drive folder after the title scanned from disk, the sidecar by id, and records the run as terminal", async () => {
    const remote = new FakeRemoteProvider();
    const d = await device({ papers: [PAPER], remote });

    const outcome = expectSynced(await d.sync.syncNow());

    expect(remote.folderPaths("library")).toEqual(["ML", `ML/${TITLE}`]);
    expect(remote.filePaths("appdata")).toEqual([`${ID}/data.json`]);
    expect(await readJson<SyncRunRecord>(d.lib.paths.layout.lastRunPath())).toEqual(outcome.record);
    expect(outcome.record).toMatchObject({ app: "terminal", host: "host-a", providerId: "google-drive", uploaded: 4 });
    expect(await listFiles(d.lib.paths.layout.tmpDir())).toEqual([]);
  });

  it("names a paper without a title after its id on Drive", async () => {
    const remote = new FakeRemoteProvider();
    const d = await device({ papers: [{ id: "notitle1", title: null, pdf: true }], remote });
    await d.sync.syncNow();
    expect(remote.folderPaths("library")).toEqual(["notitle1"]);
  });

  it("holds the shared lock file while syncing and removes it afterwards", async () => {
    const remote = new FakeRemoteProvider();
    const d = await device({ papers: [PAPER], remote });
    let during: SyncLockInfo | undefined;
    remote.onResolveRoot = async () => { during ??= await readJson<SyncLockInfo>(d.lib.paths.layout.lockPath()); };

    await d.sync.syncNow();

    expect(during).toMatchObject({ app: "terminal", pid: process.pid, host: "host-a" });
    expect(await pathExists(d.lib.paths.layout.lockPath())).toBe(false);
    expect(await listFiles(d.lib.paths.layout.syncDir())).toEqual(["google-drive.last.json", "google-drive.state.json"]);
  });

  it("maps an expired refresh token to a new sign-in (disconnected, reauth)", async () => {
    const remote = new FakeRemoteProvider();
    const d = await device({ papers: [PAPER], remote });
    remote.failWith(new ReauthRequiredError());

    expect(await d.sync.syncNow()).toMatchObject({ kind: "failed", reauth: true });
    expect(d.sync.status().state).toBe("disconnected");
    expect(await pathExists(d.lib.paths.layout.lockPath())).toBe(false);
  });

  it("writes no run record when the run fails", async () => {
    const remote = new FakeRemoteProvider();
    const d = await device({ papers: [PAPER], remote });
    remote.failWith(new Error("Drive is down"));
    expect(await d.sync.syncNow()).toEqual({ kind: "failed", error: "Drive is down", reauth: false });
    expect(await pathExists(d.lib.paths.layout.lastRunPath())).toBe(false);
  });

  it("skips without an OAuth client, touching nothing", async () => {
    const d = await device({ papers: [PAPER], client: undefined });
    expect(await d.sync.syncNow()).toEqual({ kind: "skipped", reason: "no Google OAuth client configured" });
    expect(d.factory).not.toHaveBeenCalled();
    expect(await pathExists(d.lib.paths.layout.lockPath())).toBe(false);
  });
});

describe("terminal sync: the cross-app lock on disk", () => {
  it("reports a live holder from another app as busy and leaves its lock alone", async () => {
    const d = await device({ papers: [PAPER] });
    await writeLock(d, lockInfo({ token: "vscode-token" }));

    expect(await d.sync.syncNow()).toMatchObject({ kind: "busy", holder: { app: "vscode", token: "vscode-token" } });
    expect(d.factory).not.toHaveBeenCalled();
    expect(await readJson<SyncLockInfo>(d.lib.paths.layout.lockPath())).toMatchObject({ token: "vscode-token" });
  });

  it("is busy for a live holder on this host and takes over from a dead one", async () => {
    const live = await device({ papers: [PAPER], host: "host-a" });
    await writeLock(live, lockInfo({ host: "host-a", pid: process.pid }));
    expect((await live.sync.syncNow()).kind).toBe("busy");

    const d = await device({ papers: [PAPER], host: "host-a" });
    await writeLock(d, lockInfo({ host: "host-a", pid: spawnSync(process.execPath, ["-e", ""]).pid }));
    expect(expectSynced(await d.sync.syncNow()).record.app).toBe("terminal");
    expect(await pathExists(d.lib.paths.layout.lockPath())).toBe(false);
  });

  it("stops showing the other app as syncing once its lock file is gone", async () => {
    const d = await device({ papers: [PAPER] });
    await writeLock(d, lockInfo());
    await d.sync.syncNow();
    await d.sync.refreshLastRun();
    expect(d.sync.status().state).toBe("waiting");
    await fs.rm(d.lib.paths.layout.lockPath());
    await d.sync.refreshLastRun();
    expect(d.sync.status().state).toBe("idle");
  });
});

describe("terminal sync: two devices", () => {
  async function pair(): Promise<{ remote: FakeRemoteProvider; a: Device; b: Device }> {
    const remote = new FakeRemoteProvider();
    const a = await device({ papers: [PAPER], remote, host: "host-a" });
    await a.sync.syncNow();
    const b = await device({ remote, host: "host-b" });
    return { remote, a, b };
  }

  it("downloads a paper into a folder named after its citekey and shows it without a manual reload", async () => {
    const { b } = await pair();
    const changes = jest.fn();
    b.store.onChange(changes);

    expect(expectSynced(await b.sync.syncNow()).record).toMatchObject({ host: "host-b", downloaded: 4, uploaded: 0 });

    expect(await listFiles(b.lib.paths.layout.papersRoot())).toEqual([`ML/${ID}/bib.bib`, `ML/${ID}/metadata.yaml`, `ML/${ID}/paper.pdf`]);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(b.store.paper(ID)!.record).toMatchObject({ title: TITLE, citeKey: ID, status: "reading", hasPdf: true });
  });

  it("does not reload the library when the run changed nothing locally", async () => {
    const { a } = await pair();
    const changes = jest.fn();
    a.store.onChange(changes);
    await a.sync.syncNow();
    expect(changes).not.toHaveBeenCalled();
  });

  it("does not reload the library when only a sidecar (appdata) arrived", async () => {
    const { a, b } = await pair();
    await b.sync.syncNow();
    await new PaperDataStore(createNodeSidecarPort(a.lib.paths.layout)).addHighlight(ID, 2, "positional encodings", "green", { x: 0.1, y: 0.2, width: 0.3, height: 0.05 });
    await a.sync.syncNow();
    const changes = jest.fn();
    b.store.onChange(changes);

    const outcome = expectSynced(await b.sync.syncNow());

    expect(outcome.result.namespaces.find((ns) => ns.namespace === "appdata")?.downloaded).toBe(1);
    expect(changes).not.toHaveBeenCalled();
  });

  it("keeps the same local folder when the title changes on the other device", async () => {
    const { remote, a, b } = await pair();
    await b.sync.syncNow();
    const newTitle = "Attention Is All You Need (v2, revised)";
    const fileA = path.join(a.lib.paperDir(ID, "ML"), "metadata.yaml");
    await fs.writeFile(fileA, stringify({ ...(await readYaml(fileA)), title: newTitle }));
    expect(expectSynced(await a.sync.syncNow()).record).toMatchObject({ uploaded: 1, deletedRemote: 0 });

    expect(expectSynced(await b.sync.syncNow()).record).toMatchObject({ downloaded: 1, deletedLocal: 0 });
    expect(await listFiles(b.lib.paths.layout.papersRoot())).toEqual([`ML/${ID}/bib.bib`, `ML/${ID}/metadata.yaml`, `ML/${ID}/paper.pdf`]);
    expect(b.store.paper(ID)!.record.title).toBe(newTitle);
    expect(remote.removals).toEqual([]);
  });
});

describe("terminal sync: writing projects", () => {
  it("syncs the library's projects to LabShelf Projects, without their git repository, and reports them on a device that lacks them", async () => {
    const remote = new FakeRemoteProvider();
    const a = await device({
      remote,
      host: "host-a",
      prepare: async (lib) => {
        const project = path.join(lib.root, "projects", "thesis");
        await fs.mkdir(path.join(project, ".git"), { recursive: true });
        await fs.writeFile(path.join(project, "labshelf.yaml"), "id: thesis\nformat: latex\nignore: [draft.tex]\n");
        await fs.writeFile(path.join(project, "main.tex"), "\\documentclass{article}");
        await fs.writeFile(path.join(project, "draft.tex"), "scratch");
        await fs.writeFile(path.join(project, ".git", "HEAD"), "ref: refs/heads/main");
      },
    });

    expectSynced(await a.sync.syncNow());

    expect(remote.filePaths("projects")).toEqual(["thesis/labshelf.yaml", "thesis/main.tex"]);
    const b = await device({ remote, host: "host-b" });
    expect(expectSynced(await b.sync.syncNow()).result.projectsOnlyOnDrive).toEqual(["thesis"]);
  });
});
