/**
 * @jest-environment node
 */
// The page runs a shared project's connection under its tab lease, and shares, joins, resumes and leaves projects through the core workflows over its own keys, leases and IndexedDB state.
const local: Record<string, unknown> = {};
jest.mock("../../src/platform", () => ({
  bx: { storage: { local: {
    get: async (key: string) => (key in local ? { [key]: JSON.parse(JSON.stringify(local[key])) } : {}),
    set: async (items: Record<string, unknown>) => { Object.assign(local, JSON.parse(JSON.stringify(items))); },
  } } },
}));

import { deriveShareId, readFileText, joinSharedProject, leaveSharedProject, parseProjectFile, setFileText, ShareOpenInAnotherTabError, startProjectShare, type ShareConnection } from "@labshelf/core";
import { reportPageWrites, writeMemberName } from "../../src/collab";
import { openTabLease } from "../../src/storage";
import { writeReplacements } from "../../src/writing/mountSearchHost";
import { relayNet, type RelayNet } from "../support/relayNetwork";
import { FOLDER, MAIN, openProfile, until, type Page, type Profile } from "./pageSharesTestbed";
import { FOLDER as SHARE_FOLDER, installSharingGlobals, MAIN as SHARE_MAIN, openLibrary, PROJECT_FILE, type SharingLibrary, type SharingPage } from "./shareTestbed";

jest.setTimeout(30_000);

// The page runs a shared project's connection only while it holds the share's tab lease, hands it over to another tab without losing edits, and reports a close that loses some.
describe("pageShares", () => {
  let profile: Profile;
  beforeEach(async () => { profile = await openProfile(); });
  afterEach(async () => { await profile.closeAll(); });

  const kind = (page: Page): string | undefined => page.shares.state(profile.shareId)?.kind;
  const edit = (page: Page, text: string): void => {
    const live = page.shares.live("thesis");
    if (!live) { throw new Error("the page holds no connection"); }
    setFileText(live.session.openDoc("main.typ"), text, "local");
  };
  const onDisk = (text: string) => async (): Promise<boolean> => (await profile.fs.readText(MAIN)) === text;
  const invite = () => ({ shareId: profile.shareId, shareKey: new Uint8Array(16).fill(7), relays: [{ url: "https://relay.example" }] });

  async function leaseIsFree(): Promise<boolean> {
    const lease = await openTabLease(profile.leaseName);
    if (lease.kind === "owned") { await lease.lease.release(); }
    return lease.kind === "owned";
  }

  describe("createPageShares", () => {
    it("runs a stored share and mirrors an edit of its doc to the library file", async () => {
      const page = profile.openPage();
      const listener = jest.fn();
      page.shares.onChange(listener);
      await page.connect();
      expect(kind(page)).toBe("connected");
      expect(page.shares.list().map((share) => share.shareId)).toEqual([profile.shareId]);
      expect(page.shares.live("thesis")?.comments).toBeDefined();
      expect(page.shares.live("other")).toBeUndefined();
      expect(listener).toHaveBeenCalled();
      await until(() => page.docText("main.typ") === "hello");
      edit(page, "hello world");
      await until(onDisk("hello world"));
    });

    it("keeps a second tab as an observer and resumes it with the first tab's edit once that tab closes", async () => {
      const [a, b] = [profile.openPage(), profile.openPage()];
      await a.connect();
      await until(() => a.docText("main.typ") === "hello");
      edit(a, "from tab a");
      await b.connect();
      expect(kind(b)).toBe("observer");
      expect(b.shares.active(profile.shareId)).toBeUndefined();
      await a.shares.closeAll();
      await until(() => kind(b) === "connected");
      expect(b.docText("main.typ")).toBe("from tab a");
    });

    it("resumes the waiting tab with the edit of a tab that died without closing", async () => {
      const [a, b] = [profile.openPage(), profile.openPage()];
      await a.connect();
      await until(() => a.docText("main.typ") === "hello");
      edit(a, "before the crash");
      await until(onDisk("before the crash"));
      await b.connect();
      profile.crash(a);
      await until(() => kind(b) === "connected");
      await until(() => b.docText("main.typ") === "before the crash");
    });

    it("lets a tab take the share over, after which the first tab observes and writes nothing", async () => {
      const [a, b] = [profile.openPage(), profile.openPage()];
      await a.connect();
      await until(() => a.docText("main.typ") === "hello");
      await b.connect();
      await b.shares.takeOver(profile.shareId);
      expect(kind(b)).toBe("connected");
      await until(() => kind(a) === "observer");
      expect(a.shares.live("thesis")).toBeUndefined();
      const writesBefore = a.writes.length;
      await until(() => b.docText("main.typ") === "hello");
      edit(b, "taken over");
      await until(onDisk("taken over"));
      expect(a.writes.length).toBe(writesBefore);
    });

    it("keeps an edit made while no relay is reachable (the testbed is offline) in the stored share state for the next page", async () => {
      const page = profile.openPage();
      await page.connect();
      await until(() => page.docText("main.typ") === "hello");
      edit(page, "edited offline");
      await page.shares.closeAll();
      const reloaded = profile.openPage();
      await reloaded.connect();
      await until(() => reloaded.docText("main.typ") === "edited offline");
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(reloaded.docText("main.typ")).toBe("edited offline");
    });

    it("rejects a remove whose close leaves an update unstored, and frees the lease", async () => {
      const page = profile.openPage();
      await page.connect();
      const connection = page.shares.active(profile.shareId)!;
      const close = connection.close.bind(connection);
      Object.assign(connection, { close: () => close().then(() => { throw new Error("the disk is full"); }) });
      await expect(page.shares.remove(profile.shareId)).rejects.toThrow("the disk is full");
      expect(page.shares.active(profile.shareId)).toBeUndefined();
      expect(await leaseIsFree()).toBe(true);
    });

    it("refuses to join a share another tab holds, without observing it", async () => {
      const held = await openTabLease(profile.leaseName);
      const page = profile.openPage();
      await expect(page.shares.connect(invite(), { mode: "join", signal: new AbortController().signal })).rejects.toBeInstanceOf(ShareOpenInAnotherTabError);
      expect(page.shares.state(profile.shareId)).toBeUndefined();
      if (held.kind === "owned") { await held.lease.release(); }
    });

    it("closes a connection that stands only after the page closed, and frees its lease", async () => {
      const page = profile.openPage();
      const connecting = page.shares.connect(invite(), { mode: "resume", folder: FOLDER });
      await page.shares.closeAll();
      page.shares.add(await connecting);
      expect(page.shares.active(profile.shareId)).toBeUndefined();
      await until(leaseIsFree);
    });

    it("uses the stored display name, and the default before one is stored", async () => {
      expect(profile.openPage().shares.name()).toBe("Guest");
      await writeMemberName("Ada");
      const page = profile.openPage();
      await until(() => page.shares.name() === "Ada");
    });
  });
});

// The page shares, joins, resumes and leaves projects through the core workflows over its own keys, tab leases and IndexedDB state.
describe("pageSharesComposer", () => {
  let net: RelayNet;
  let libraries: SharingLibrary[];
  const signal = new AbortController().signal;

  beforeEach(() => { installSharingGlobals(); net = relayNet(); libraries = []; });
  afterEach(async () => { await Promise.allSettled(libraries.map((library) => library.closeAll())); net.stop(); });

  async function library(seed: boolean): Promise<SharingLibrary> {
    const opened = await openLibrary(net, seed);
    libraries.push(opened);
    return opened;
  }

  const sharedField = async (library: SharingLibrary, folder = SHARE_FOLDER): Promise<string | undefined> => {
    const parsed = parseProjectFile(await library.fs.readText(`${folder}/labshelf.yaml`));
    return parsed.ok ? parsed.settings.shared : undefined;
  };

  /** Shares the seeded project from a fresh page and resolves to its invite and connection. */
  async function shareSeeded(owner: SharingLibrary): Promise<{ page: SharingPage; invite: string; shareId: string; connection: ShareConnection }> {
    const page = owner.open();
    await page.sharing.ready();
    const outcome = await startProjectShare(page.sharing.ports, { folder: SHARE_FOLDER, shared: undefined, signal });
    if (outcome.kind !== "shared") { throw new Error(`the share ended as ${outcome.kind}`); }
    return { page, invite: outcome.invite, shareId: outcome.connection.shareId, connection: outcome.connection };
  }

  describe("createPageShare", () => {
    it("shares a project from the browser that another device joins with its files", async () => {
      const owner = await library(true);
      const { invite, shareId } = await shareSeeded(owner);
      expect(await sharedField(owner)).toBe(shareId);
      const member = await library(false);
      const page = member.open();
      await page.sharing.ready();
      const joined = await joinSharedProject(page.sharing.ports, invite, signal);
      expect(joined.kind).toBe("joined");
      if (joined.kind === "refused") { return; }
      await until(async () => (await member.fs.exists(`${joined.folder}/main.typ`)) && (await member.fs.readText(`${joined.folder}/main.typ`)) === "= Hello\n");
      expect(await sharedField(member, joined.folder)).toBe(shareId);
    });

    it("tells its listeners after a share and a leave re-read the project list", async () => {
      const owner = await library(true);
      const page = owner.open();
      await page.sharing.ready();
      const changed = jest.fn();
      page.sharing.onProjectsChange(changed);
      const outcome = await startProjectShare(page.sharing.ports, { folder: SHARE_FOLDER, shared: undefined, signal });
      expect(outcome.kind).toBe("shared");
      const afterShare = changed.mock.calls.length;
      expect(afterShare).toBeGreaterThan(0);
      if (outcome.kind !== "shared") { return; }
      await leaveSharedProject(page.sharing.ports, { folder: SHARE_FOLDER, shareId: outcome.connection.shareId });
      expect(changed.mock.calls.length).toBeGreaterThan(afterShare);
    });

    it("resumes a joined project after a reload, and joining its invite again creates nothing", async () => {
      const owner = await library(true);
      const { invite, shareId } = await shareSeeded(owner);
      const member = await library(false);
      const first = member.open();
      await first.sharing.ready();
      await joinSharedProject(first.sharing.ports, invite, signal);
      const folders = (await member.projects()).map((entry) => entry.folder);
      await first.sharing.closeAll();
      const reloaded = member.open();
      await reloaded.sharing.ready();
      expect(reloaded.sharing.shares.active(shareId)).toBeDefined();
      expect(await joinSharedProject(reloaded.sharing.ports, invite, signal)).toEqual({ kind: "active", folder: folders[0] });
      expect((await member.projects()).map((entry) => entry.folder)).toEqual(folders);
      expect(reloaded.reports.missingKey).not.toHaveBeenCalled();
      expect(reloaded.reports.failed).not.toHaveBeenCalled();
    });

    it("asks once to join a shared project whose key this device lacks", async () => {
      const lost = await library(false);
      const shareId = await deriveShareId(new Uint8Array(16).fill(4));
      await lost.fs.writeText(PROJECT_FILE, `id: thesis\nformat: typst\nshared: ${shareId}\n`);
      const page = lost.open();
      await page.sharing.ready();
      await page.sharing.reload();
      expect(page.reports.missingKey).toHaveBeenCalledTimes(1);
      expect(page.reports.missingKey.mock.calls[0]?.[0]).toMatchObject({ folder: SHARE_FOLDER });
      expect(page.sharing.shares.list()).toEqual([]);
    });

    it("publishes nothing when the owner cancels the relay prompt", async () => {
      const owner = await library(true);
      const page = owner.open({ relay: false });
      await page.sharing.ready();
      expect(await startProjectShare(page.sharing.ports, { folder: SHARE_FOLDER, shared: undefined, signal })).toEqual({ kind: "noRelay" });
      expect(page.requireRelay).toHaveBeenCalledTimes(1);
      expect(await sharedField(owner)).toBeUndefined();
      expect(page.sharing.shares.list()).toEqual([]);
      expect(net.requests()).toBe(0);
    });

    it("keeps the key, the shared field and the files when the leave cannot store the last edits", async () => {
      const owner = await library(true);
      const { page, shareId, connection } = await shareSeeded(owner);
      const close = connection.close.bind(connection);
      Object.assign(connection, { close: () => close().then(() => { throw new Error("the disk is full"); }) });
      await expect(leaveSharedProject(page.sharing.ports, { folder: SHARE_FOLDER, shareId })).rejects.toThrow("the disk is full");
      expect(await page.sharing.ports.keys.invite(shareId)).toBeDefined();
      expect(await sharedField(owner)).toBe(shareId);
      expect(await owner.fs.readText(SHARE_MAIN)).toBe("= Hello\n");
      expect(await owner.storedState(shareId)).toBeGreaterThan(0);
    });

    it("forgets the key, the shared field and the stored state on leave, and keeps the files", async () => {
      const owner = await library(true);
      const { page, shareId } = await shareSeeded(owner);
      await leaveSharedProject(page.sharing.ports, { folder: SHARE_FOLDER, shareId });
      expect(page.sharing.shares.active(shareId)).toBeUndefined();
      expect(await page.sharing.ports.keys.invite(shareId)).toBeUndefined();
      expect(await sharedField(owner)).toBeUndefined();
      expect(await owner.storedState(shareId)).toBe(0);
      expect(await owner.fs.readText(SHARE_MAIN)).toBe("= Hello\n");
    });

    it("gives a source tab the live share of a shared project", async () => {
      const owner = await library(true);
      const { page } = await shareSeeded(owner);
      const [entry] = await owner.projects();
      const live = entry && (await page.sharing.liveShare(entry, false));
      expect(live).toBeDefined();
      await until(() => (live ? readFileText(live.session.openDoc("main.typ")).toString() : "") === "= Hello\n");
    });

    it("brings a replace-in-files edit of a shared file into the share", async () => {
      const owner = await library(true);
      const { connection } = await shareSeeded(owner);
      const text = (): string => readFileText(connection.session.openDoc("main.typ")).toString();
      await until(() => text() === "= Hello\n");
      // The mirror's first scan is over, so only the page's report brings the edit in: browser storage has no watcher.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const pageFs = reportPageWrites(owner.fs);
      expect(await writeReplacements(pageFs, [{ path: SHARE_MAIN, line: 0, column: 2, length: 5 }], /Hello/g, "World")).toBe(1);
      await until(() => text() === "= World\n");
    });
  });
});
