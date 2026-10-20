/**
 * @jest-environment node
 */
// The page runs a shared project's connection only while it holds the share's tab lease, and hands it over to another tab without losing edits.
const local: Record<string, unknown> = {};
jest.mock("../../../../src/platform", () => ({
  bx: { storage: { local: {
    get: async (key: string) => (key in local ? { [key]: JSON.parse(JSON.stringify(local[key])) } : {}),
    set: async (items: Record<string, unknown>) => { Object.assign(local, JSON.parse(JSON.stringify(items))); },
  } } },
}));

import { deriveShareId, formatInvite, replaceFileText } from "@labshelf/core";
import { acquireTabLease, tabLeaseName } from "../../../../src/storage";
import { FOLDER, MAIN, openProfile, until, type Page, type Profile } from "./pageSharesTestbed";

jest.setTimeout(30_000);

let profile: Profile;
beforeEach(async () => { profile = await openProfile(); });
afterEach(async () => { await profile.closeAll(); });

const connect = (page: Page): Promise<void> => page.shares.connect("thesis", profile.shareId, FOLDER);
const kind = (page: Page): string | undefined => page.shares.state("thesis")?.kind;
const edit = (page: Page, text: string): void => {
  const active = page.shares.active("thesis");
  if (!active) { throw new Error("the page holds no connection"); }
  replaceFileText(active.session.openDoc("main.typ"), text, "local");
};
const onDisk = (text: string) => async (): Promise<boolean> => (await profile.fs.readText(MAIN)) === text;

describe("createPageShares", () => {
  it("resumes a stored share and mirrors an edit of its doc to the library file", async () => {
    const page = profile.openPage();
    const listener = jest.fn();
    page.shares.onChange(listener);
    await connect(page);
    expect(kind(page)).toBe("connected");
    expect(page.shares.active("thesis")?.comments).toBeDefined();
    expect(page.shares.active("other")).toBeUndefined();
    expect(listener).toHaveBeenCalled();
    await until(() => page.docText("main.typ") === "hello");
    edit(page, "hello world");
    await until(onDisk("hello world"));
  });

  it("keeps a second tab as an observer and resumes it with the first tab's edit once that tab closes", async () => {
    const [a, b] = [profile.openPage(), profile.openPage()];
    await connect(a);
    await until(() => a.docText("main.typ") === "hello");
    edit(a, "from tab a");
    await connect(b);
    expect(kind(b)).toBe("observer");
    expect(b.shares.active("thesis")).toBeUndefined();
    await a.shares.closeAll();
    await until(() => kind(b) === "connected");
    expect(b.docText("main.typ")).toBe("from tab a");
  });

  it("resumes the waiting tab with the edit of a tab that died without closing", async () => {
    const [a, b] = [profile.openPage(), profile.openPage()];
    await connect(a);
    await until(() => a.docText("main.typ") === "hello");
    edit(a, "before the crash");
    await until(onDisk("before the crash"));
    await connect(b);
    profile.crash(a);
    await until(() => kind(b) === "connected");
    await until(() => b.docText("main.typ") === "before the crash");
  });

  it("lets a tab take the share over, after which the first tab observes and writes nothing", async () => {
    const [a, b] = [profile.openPage(), profile.openPage()];
    await connect(a);
    await until(() => a.docText("main.typ") === "hello");
    await connect(b);
    await b.shares.takeOver("thesis");
    expect(kind(b)).toBe("connected");
    await until(() => kind(a) === "observer");
    expect(a.shares.active("thesis")).toBeUndefined();
    const writesBefore = a.writes.length;
    await until(() => b.docText("main.typ") === "hello");
    edit(b, "taken over");
    await until(onDisk("taken over"));
    expect(a.writes.length).toBe(writesBefore);
  });

  it("connects once for repeated calls and keeps the text once across a reconnect", async () => {
    const page = profile.openPage();
    await Promise.all([connect(page), connect(page)]);
    await until(() => page.docText("main.typ") === "hello");
    await page.shares.closeAll();
    expect(page.shares.active("thesis")).toBeUndefined();
    await connect(page);
    await until(() => page.docText("main.typ") === "hello");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(page.docText("main.typ")).toBe("hello");
    expect(await profile.fs.readText(MAIN)).toBe("hello");
  });

  it("fails a connect for a share whose key was never stored", async () => {
    const page = profile.openPage();
    await expect(page.shares.connect("other", "f".repeat(32), "projects/other")).rejects.toThrow("f".repeat(32));
    expect(page.shares.state("other")?.kind).toBe("failed");
    expect(page.shares.active("other")).toBeUndefined();
  });

  it("refuses an invalid invite before taking any lease", async () => {
    await expect(profile.openPage().shares.join("not an invite")).rejects.toThrow("no valid invite");
  });

  describe("join with no peer", () => {
    let inviteText: string;
    let leaseName: string;
    beforeEach(async () => {
      const shareKey = new Uint8Array(16).fill(9);
      inviteText = await formatInvite({ shareKey, relays: [{ url: "https://relay.example" }] });
      leaseName = tabLeaseName(profile.libraryId, await deriveShareId(shareKey));
    });

    it("releases the lease and keeps no share when the page closes during the join", async () => {
      const page = profile.openPage();
      const joining = page.shares.join(inviteText);
      const settled = joining.then(() => "joined", () => "failed");
      await new Promise((resolve) => setTimeout(resolve, 200));
      await page.shares.closeAll();
      expect(await settled).toBe("failed");
      const lease = await acquireTabLease(leaseName);
      expect(lease.kind).toBe("owned");
      if (lease.kind === "owned") { await lease.lease.release(); }
      expect(page.shares.active("thesis")).toBeUndefined();
    });

    it("refuses a share another tab holds", async () => {
      const held = await acquireTabLease(leaseName);
      await expect(profile.openPage().shares.join(inviteText)).rejects.toThrow("open in another tab");
      if (held.kind === "owned") { await held.lease.release(); }
    });
  });

  it("uses the display name it is given", async () => {
    const page = profile.openPage();
    expect(page.shares.name()).toBe("Guest");
    await page.shares.setName("Ada");
    expect(page.shares.name()).toBe("Ada");
  });
});
