/**
 * @jest-environment node
 */
// The page runs a shared project's connection only while it holds the share's tab lease, hands it over to another tab without losing edits, and reports a close that loses some.
const local: Record<string, unknown> = {};
jest.mock("../../src/platform", () => ({
  bx: { storage: { local: {
    get: async (key: string) => (key in local ? { [key]: JSON.parse(JSON.stringify(local[key])) } : {}),
    set: async (items: Record<string, unknown>) => { Object.assign(local, JSON.parse(JSON.stringify(items))); },
  } } },
}));

import { setFileText, ShareOpenInAnotherTabError } from "@labshelf/core";
import { saveDisplayName } from "../../src/collab";
import { acquireTabLease } from "../../src/storage";
import { FOLDER, MAIN, openProfile, until, type Page, type Profile } from "./pageSharesTestbed";

jest.setTimeout(30_000);

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
  const lease = await acquireTabLease(profile.leaseName);
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
    const held = await acquireTabLease(profile.leaseName);
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
    await saveDisplayName("Ada");
    const page = profile.openPage();
    await until(() => page.shares.name() === "Ada");
  });
});
