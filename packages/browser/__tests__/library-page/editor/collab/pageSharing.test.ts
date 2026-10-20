/**
 * @jest-environment node
 */
// The page shares, joins, resumes and leaves projects through the core workflows over its own keys, tab leases and IndexedDB state.
const local: Record<string, unknown> = {};
jest.mock("../../../../src/platform", () => ({
  bx: { storage: { local: {
    get: async (key: string) => (key in local ? { [key]: JSON.parse(JSON.stringify(local[key])) } : {}),
    set: async (items: Record<string, unknown>) => { Object.assign(local, JSON.parse(JSON.stringify(items))); },
  } } },
}));

import { deriveShareId, fileText, joinSharedProject, leaveSharedProject, parseProjectFile, shareProject, type ShareConnection } from "@labshelf/core";
import { reportPageWrites } from "../../../../src/library-page/editor/collab";
import { replaceInFiles } from "../../../../src/library-page/project-search/replaceInFiles";
import { relayNet, type RelayNet } from "../../../support/relayNetwork";
import { until } from "./pageSharesTestbed";
import { FOLDER, installSharingGlobals, MAIN, openLibrary, PROJECT_FILE, type SharingLibrary, type SharingPage } from "./sharingTestbed";

jest.setTimeout(30_000);

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

const sharedField = async (library: SharingLibrary, folder = FOLDER): Promise<string | undefined> => {
  const parsed = parseProjectFile(await library.fs.readText(`${folder}/labshelf.yaml`));
  return parsed.ok ? parsed.settings.shared : undefined;
};

/** Shares the seeded project from a fresh page and resolves to its invite and connection. */
async function shareSeeded(owner: SharingLibrary): Promise<{ page: SharingPage; invite: string; shareId: string; connection: ShareConnection }> {
  const page = owner.open();
  await page.sharing.ready();
  const outcome = await shareProject(page.sharing.ports, { folder: FOLDER, shared: undefined, signal });
  if (outcome.kind !== "shared") { throw new Error(`the share ended as ${outcome.kind}`); }
  return { page, invite: outcome.invite, shareId: outcome.connection.shareId, connection: outcome.connection };
}

describe("createPageSharing", () => {
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
    expect(page.reports.missingKey.mock.calls[0]?.[0]).toMatchObject({ folder: FOLDER });
    expect(page.sharing.shares.list()).toEqual([]);
  });

  it("publishes nothing when the owner cancels the relay prompt", async () => {
    const owner = await library(true);
    const page = owner.open({ relay: false });
    await page.sharing.ready();
    expect(await shareProject(page.sharing.ports, { folder: FOLDER, shared: undefined, signal })).toEqual({ kind: "noRelay" });
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
    await expect(leaveSharedProject(page.sharing.ports, { folder: FOLDER, shareId })).rejects.toThrow("the disk is full");
    expect(await page.sharing.ports.keys.invite(shareId)).toBeDefined();
    expect(await sharedField(owner)).toBe(shareId);
    expect(await owner.fs.readText(MAIN)).toBe("= Hello\n");
    expect(await owner.storedState(shareId)).toBeGreaterThan(0);
  });

  it("forgets the key, the shared field and the stored state on leave, and keeps the files", async () => {
    const owner = await library(true);
    const { page, shareId } = await shareSeeded(owner);
    await leaveSharedProject(page.sharing.ports, { folder: FOLDER, shareId });
    expect(page.sharing.shares.active(shareId)).toBeUndefined();
    expect(await page.sharing.ports.keys.invite(shareId)).toBeUndefined();
    expect(await sharedField(owner)).toBeUndefined();
    expect(await owner.storedState(shareId)).toBe(0);
    expect(await owner.fs.readText(MAIN)).toBe("= Hello\n");
  });

  it("gives a source tab the live share of a shared project", async () => {
    const owner = await library(true);
    const { page } = await shareSeeded(owner);
    const [entry] = await owner.projects();
    const live = entry && (await page.sharing.liveShare(entry, false));
    expect(live).toBeDefined();
    await until(() => (live ? fileText(live.session.openDoc("main.typ")).toString() : "") === "= Hello\n");
  });

  it("brings a replace-in-files edit of a shared file into the share", async () => {
    const owner = await library(true);
    const { connection } = await shareSeeded(owner);
    const text = (): string => fileText(connection.session.openDoc("main.typ")).toString();
    await until(() => text() === "= Hello\n");
    // The mirror's first scan is over, so only the page's report brings the edit in: browser storage has no watcher.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const pageFs = reportPageWrites(owner.fs);
    expect(await replaceInFiles(pageFs, [{ path: MAIN, line: 0, column: 2, length: 5 }], /Hello/g, "World")).toBe(1);
    await until(() => text() === "= World\n");
  });
});
