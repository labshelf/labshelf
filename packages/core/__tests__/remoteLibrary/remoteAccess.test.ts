/** Pins the Remote access switch logic: turning on sends the owner email, registers the directory when needed and syncs; turning off clears the Mirror. */
import { createRemoteAccess } from "../../src/remoteLibrary/remoteAccess";
import { MirrorRefusal, type MirrorRelay, type MirrorSettings, type MirrorStatus } from "../../src/remoteLibrary/mirrorRelay";
import type { MirrorRunResult } from "../../src/remoteLibrary/mirrorRunner";
import type { MirrorStateStore } from "../../src/remoteLibrary/mirrorState";

const SIGN_IN_MESSAGE = "Remote access needs Cloudflare sign-in";
const SYNCED: MirrorRunResult = { status: "synced", uploaded: 2, deleted: 0, skipped: [] };

type Deps = {
  readEmail?: () => Promise<string | undefined>;
  self?: () => Promise<string | undefined>;
  settingsError?: Error;
};

const STATUS: MirrorStatus = { generation: "g1", store: "do", used: 0, limit: 5_000_000_000, includePdfs: false, rows: 0, edits: 0, r2: { bound: false, month: "2026-11", operations: 0 } };

function world(deps: Deps = {}) {
  const calls: string[] = [];
  const putOwnerArgs: string[] = [];
  const settings: MirrorSettings[] = [];
  const relay: MirrorRelay = {
    putOwner: async (email) => { calls.push("putOwner"); putOwnerArgs.push(email); },
    lease: async () => { calls.push("lease"); return true; },
    putRows: async () => { calls.push("putRows"); },
    clear: async () => { calls.push("relay.clear"); },
    putFile: async () => { calls.push("putFile"); },
    status: async () => { calls.push("status"); return STATUS; },
    setSettings: async (value) => {
      calls.push("setSettings");
      if (deps.settingsError) throw deps.settingsError;
      settings.push(value);
      return STATUS;
    },
    edits: async () => [],
    ackEdits: async () => undefined,
    readFile: async () => new Uint8Array(),
  };
  const state: MirrorStateStore = {
    read: async () => { calls.push("state.read"); return undefined; },
    write: async () => { calls.push("state.write"); },
    clear: async () => { calls.push("state.clear"); },
  };
  const access = createRemoteAccess({
    readEmail: async () => { calls.push("readEmail"); return deps.readEmail ? deps.readEmail() : "owner@lab.org"; },
    relay,
    directory: {
      self: async () => { calls.push("self"); return deps.self ? deps.self() : undefined; },
      register: async () => { calls.push("register"); },
    },
    runner: { run: async () => { calls.push("run"); return SYNCED; } },
    state,
    selection: async () => ({
      papers: [{ id: "p1", folder: "ml", trashed: false, record: {} }, { id: "p2", folder: "", trashed: true, record: {} }],
      listFiles: async () => ["papers/ml/p1/paper.pdf", "papers/ml/p1/notes.qmd", "papers/p2/paper.pdf"],
      readText: async () => "", readBytes: async () => new Uint8Array(),
      fileSize: async (path: string) => (path === "papers/ml/p1/paper.pdf" ? 2048 : 1),
      exportDeck: async () => ({ html: "" }),
    }),
  });
  return { access, calls, putOwnerArgs, settings };
}

describe("createRemoteAccess turnOn", () => {
  it("4.1a puts the owner email and runs the first sync", async () => {
    const { access, calls, putOwnerArgs } = world();
    const result = await access.turnOn();
    expect(result).toEqual({ ok: true });
    expect(putOwnerArgs).toEqual(["owner@lab.org"]);
    expect(calls.filter((call) => call === "run")).toHaveLength(1);
  });

  it("4.1a registers the directory when self() answers undefined", async () => {
    const { access, calls } = world({ self: async () => undefined });
    await access.turnOn();
    expect(calls.filter((call) => call === "register")).toHaveLength(1);
  });

  it("4.1a skips the registration when self() answers a URL", async () => {
    const { access, calls } = world({ self: async () => "https://directory.labshelf.org/u/abc" });
    const result = await access.turnOn();
    expect(result).toEqual({ ok: true });
    expect(calls).not.toContain("register");
    expect(calls).toContain("run");
  });

  it("4.1a sends the owner before the sync runs", async () => {
    const { access, calls } = world();
    await access.turnOn();
    expect(calls.indexOf("putOwner")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("putOwner")).toBeLessThan(calls.indexOf("run"));
  });

  it("4.1a registers the directory before the sync runs", async () => {
    const { access, calls } = world({ self: async () => undefined });
    await access.turnOn();
    expect(calls.indexOf("register")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("register")).toBeLessThan(calls.indexOf("run"));
  });

  it("4.1b answers needs_sign_in with the sign-in text when there is no email", async () => {
    const { access } = world({ readEmail: async () => undefined });
    const result = await access.turnOn();
    expect(result).toEqual({ ok: false, reason: "needs_sign_in", message: SIGN_IN_MESSAGE });
  });

  it("4.1b calls nothing but readEmail when there is no email", async () => {
    const { access, calls } = world({ readEmail: async () => undefined });
    await access.turnOn();
    expect(calls).toEqual(["readEmail"]);
  });
});

describe("createRemoteAccess turnOff", () => {
  it("4.1c clears the relay's rows and the local table", async () => {
    const { access, calls } = world();
    const result = await access.turnOff();
    expect(result).toEqual({ ok: true });
    expect(calls.filter((call) => call === "relay.clear")).toHaveLength(1);
    expect(calls.filter((call) => call === "state.clear")).toHaveLength(1);
  });

  it("4.1c neither syncs nor sends the owner when turning off", async () => {
    const { access, calls } = world();
    await access.turnOff();
    expect(calls).not.toContain("run");
    expect(calls).not.toContain("putOwner");
    expect(calls).not.toContain("register");
  });
});

describe("createRemoteAccess settings", () => {
  it("setIncludePdfs saves the setting and then syncs", async () => {
    const { access, calls, settings } = world();
    expect(await access.setIncludePdfs(true)).toEqual({ ok: true });
    expect(settings).toEqual([{ includePdfs: true }]);
    expect(calls.indexOf("setSettings")).toBeLessThan(calls.indexOf("run"));
    expect(calls).not.toContain("state.clear");
  });

  it("setLimit sends the bytes, or null for the default", async () => {
    const { access, settings } = world();
    await access.setLimit(2_000_000_000);
    await access.setLimit(null);
    expect(settings).toEqual([{ limit: 2_000_000_000 }, { limit: null }]);
  });

  it("moveStore saves the store, clears the device table, then syncs", async () => {
    const { access, calls, settings } = world();
    expect(await access.moveStore("r2")).toEqual({ ok: true });
    expect(settings).toEqual([{ store: "r2" }]);
    expect(calls.slice(calls.indexOf("setSettings"))).toEqual(["setSettings", "state.clear", "run"]);
  });

  it("moveStore answers no_bucket with the bucket wording and does not sync when R2 has no bucket", async () => {
    const { access, calls } = world({ settingsError: new MirrorRefusal("no bucket", 409, "noBucket") });
    expect(await access.moveStore("r2")).toEqual({
      ok: false, reason: "no_bucket", message: "Create the R2 bucket labshelf-mirror first (R2 needs a card on your Cloudflare account).",
    });
    expect(calls).not.toContain("run");
    expect(calls).not.toContain("state.clear");
  });

  it("a refused limit answers failed without syncing", async () => {
    const { access, calls } = world({ settingsError: new MirrorRefusal("bad", 400, "malformed") });
    expect(await access.setLimit(9e9)).toMatchObject({ ok: false, reason: "failed" });
    expect(calls).not.toContain("run");
  });

  it("status answers the Mirror's status", async () => {
    const { access } = world();
    expect(await access.status()).toEqual(STATUS);
  });

  it("estimatePaperPdfs sums the PDFs of kept papers from the selection deps", async () => {
    const { access } = world();
    expect(await access.estimatePaperPdfs()).toEqual({ bytes: 2048, files: 1 });
  });
});
