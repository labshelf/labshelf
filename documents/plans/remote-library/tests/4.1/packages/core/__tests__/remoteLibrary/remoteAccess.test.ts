/** Pins the Remote access switch logic: turning on sends the owner email, registers the directory when needed and syncs; turning off clears the Mirror. */
import { createRemoteAccess } from "../../src/remoteLibrary/remoteAccess";
import type { MirrorRelay } from "../../src/remoteLibrary/mirrorRelay";
import type { MirrorRunResult } from "../../src/remoteLibrary/mirrorRunner";
import type { MirrorStateStore } from "../../src/remoteLibrary/mirrorState";

const SIGN_IN_MESSAGE = "Remote access needs Cloudflare sign-in";
const SYNCED: MirrorRunResult = { status: "synced", uploaded: 2, deleted: 0, skipped: [] };

type Deps = {
  readEmail?: () => Promise<string | undefined>;
  self?: () => Promise<string | undefined>;
};

function world(deps: Deps = {}) {
  const calls: string[] = [];
  const putOwnerArgs: string[] = [];
  const relay: MirrorRelay = {
    putOwner: async (email) => { calls.push("putOwner"); putOwnerArgs.push(email); },
    lease: async () => { calls.push("lease"); return true; },
    putRows: async () => { calls.push("putRows"); },
    clear: async () => { calls.push("relay.clear"); },
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
  });
  return { access, calls, putOwnerArgs };
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
