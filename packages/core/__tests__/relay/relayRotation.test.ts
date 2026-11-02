// Rotation of the owner's relay (D12), retirement of the old Worker after its grace period, and the abuse check (D13).
import {
  createCloudflareAbuseSignal, decideAbuseRotation, RELAY_RETIRE_GRACE_MS, retireRelayIfDue, rotateRelay, rotateRelayOnAbuse,
  type RelayAccount, type RelayLock, type RotateRelayDeps,
} from "../../src/relay/index";
import { offerOwnRelayToShares, removeOwnRelayOfferFromShares, type ShareFlowPorts } from "../../src/share/index";
import { createShareSession } from "../../src/collab/index";
import { addRelay, createSwitchableTransport, readRelayList } from "../../src/collab/relays/index";
import { deriveContentShareKey } from "../../src/collab/invite/index";
import type { ShareConnection } from "../../src/collab/session/index";
import type { ProjectEntry } from "../../src/writing/project/index";
import { accountWorld, connectedAccount, routes, type World, type WorldOptions } from "./fakeRelayAccount";
import { workflowDevice } from "../share/workflowTestbed";
import { Network } from "../collab/session/connectionTestbed";
import { ONE, openGroupClient, TWO } from "../collab/relays/relayGroup";
import { fakeLogger, SHARE_ID, SHARE_KEY } from "../collab/testSession";
import { runUntil } from "../collab/fakeNetwork";
import { runFor } from "../collab/relays/fakeRelay";

const OWNER = "Owner";
const OTHER_SHARE = "e".repeat(32);
const OLD_URL = connectedAccount.relayUrl;

function rotationWorld(options: WorldOptions = {}): World {
  return accountWorld({ existingKvNamespaces: [{ id: "kv-1", title: "labshelf-relay" }], ...options });
}

async function storeAccount(world: World, overrides: Partial<RelayAccount> = {}): Promise<RelayAccount> {
  const account: RelayAccount = { ...connectedAccount, credential: { kind: "token", token: "access-1" }, ...overrides };
  await world.store.save(account);
  return account;
}

const sharedEntry = (shareId: string): ProjectEntry => ({
  kind: "ready", folder: `/lib/projects/${shareId}`, location: "library", main: undefined,
  settings: { id: shareId, title: shareId, format: "typst", main: "main.typ", shared: shareId },
} as unknown as ProjectEntry);

const stubConnection = (session: ShareConnection["session"]): ShareConnection =>
  ({ shareId: SHARE_ID, shareKey: SHARE_KEY, session } as unknown as ShareConnection);

/** Share ports of the owner's device: one connected share, plus `extra` shared projects that are not connected. */
function ownerPorts(net: Network, world: World, connection: ShareConnection, relayFor: (url: string) => string, extra: string[] = []): ShareFlowPorts {
  const base = workflowDevice(net, OWNER).ports;
  return {
    ...base,
    keys: base.keys,
    shares: { ...base.shares, active: (id) => (id === SHARE_ID ? connection : undefined), list: () => [connection] },
    projects: { list: () => [SHARE_ID, ...extra].map(sharedEntry), reload: async () => {} },
    relay: {
      get: async () => {
        const account = await world.store.get();
        return account && { ...account, relayUrl: relayFor(account.relayUrl) };
      },
    },
  };
}

interface Harness { deps: RotateRelayDeps; calls: string[] }

function rotationDeps(world: World, ports?: ShareFlowPorts, relayFor: (url: string) => string = (url) => url, during?: () => void): Harness {
  const calls: string[] = [];
  const withLock: RelayLock = async (run) => { calls.push("lock"); return run(); };
  const deps: RotateRelayDeps = {
    ...world.deps, withLock, script: "export default {}",
    offerToShares: async () => {
      calls.push("offer");
      during?.();
      if (ports) { await offerOwnRelayToShares(ports); }
    },
    withdrawFromShares: async (url) => {
      calls.push(`withdraw ${url}`);
      if (ports) { await removeOwnRelayOfferFromShares(ports, relayFor(url)); }
    },
    updateRegistration: async ({ previousUrl, relayUrl }) => { calls.push(`registration ${previousUrl} -> ${relayUrl}`); },
  };
  return { deps, calls };
}

describe("rotateRelay (3.1a)", () => {
  it("lists only the new relay in every share and stored invite, and keeps the old one as retiring", async () => {
    const net = new Network();
    const world = rotationWorld();
    await storeAccount(world);
    const session = createShareSession({
      shareId: SHARE_ID, contentKey: await deriveContentShareKey(SHARE_KEY), transport: createSwitchableTransport(), logger: fakeLogger(), scheduler: net.clock,
    });
    addRelay(session.index, { url: OLD_URL, addedBy: OWNER });
    const connection = stubConnection(session);
    const ports = ownerPorts(net, world, connection, (url) => url, [OTHER_SHARE]);
    await ports.keys.remember({ shareId: SHARE_ID, shareKey: SHARE_KEY, relays: [{ url: OLD_URL }] });
    await ports.keys.remember({ shareId: OTHER_SHARE, shareKey: SHARE_KEY, relays: [{ url: OLD_URL }, { url: "https://friend.example" }] });
    const { deps, calls } = rotationDeps(world, ports);
    const start = world.clock.now();

    const outcome = await rotateRelay(deps);

    const account = (await world.store.get())!;
    expect(account.relayUrl).not.toBe(OLD_URL);
    expect(outcome).toEqual({ kind: "rotated", previousUrl: OLD_URL, relayUrl: account.relayUrl, retireAfter: start + RELAY_RETIRE_GRACE_MS });
    expect(readRelayList(session.index).map((entry) => entry.url)).toEqual([account.relayUrl]);
    expect((await ports.keys.invite(SHARE_ID))!.relays).toEqual([{ url: account.relayUrl }]);
    expect((await ports.keys.invite(OTHER_SHARE))!.relays).toEqual([{ url: "https://friend.example" }, { url: account.relayUrl }]);
    expect(account.retiring).toEqual({
      workerName: OLD_URL.slice("https://".length).split(".")[0], relayUrl: OLD_URL, ownerSecret: connectedAccount.ownerSecret,
      kvNamespaceId: "kv-1", retireAfter: start + RELAY_RETIRE_GRACE_MS,
    });
    // The new relay reuses the namespace titled labshelf-relay; the share Worker is never rotated.
    expect(account.kvNamespaceId).toBe("kv-1");
    expect(account.shareWorker).toEqual(connectedAccount.shareWorker);
    expect(world.scriptCalls.every((call) => !call.startsWith("DELETE"))).toBe(true);
    expect(world.scriptCalls.some((call) => call.includes(connectedAccount.shareWorker.name))).toBe(false);
    expect(calls).toEqual(["lock", "offer", `withdraw ${OLD_URL}`, `registration ${OLD_URL} -> ${account.relayUrl}`]);
    await session.close();
  });

  it("does not rotate again while the previous relay is within its grace period", async () => {
    const world = rotationWorld();
    await storeAccount(world);
    const start = world.clock.now();
    await rotateRelay(rotationDeps(world).deps);
    const { deps, calls } = rotationDeps(world);
    const outcome = await rotateRelay(deps);
    expect(outcome).toEqual({ kind: "pending", retireAfter: start + RELAY_RETIRE_GRACE_MS });
    expect(calls).toEqual(["lock"]);
  });

  it("resolves undefined without an account", async () => {
    const world = rotationWorld();
    const { deps, calls } = rotationDeps(world);
    await expect(rotateRelay(deps)).resolves.toBeUndefined();
    expect(calls).toEqual(["lock"]);
  });
});

describe("rotateRelay with a peer (3.1b)", () => {
  it("carries edits made during the rotation to a peer that moves to the new relay", async () => {
    const net = new Network();
    const world = rotationWorld();
    await storeAccount(world, { relayUrl: ONE });
    const owner = await openGroupClient(net.hosts, net.clock, OWNER, { owner: true, relays: [ONE] });
    const peer = await openGroupClient(net.hosts, net.clock, "Peer", { relays: [ONE] });
    const peerState = () => ({ text: peer.text().toString(), current: peer.selector.current, list: readRelayList(peer.session.index).map((entry) => entry.url) });
    try {
      expect(await runUntil(net.clock, () => owner.selector.current === ONE && peer.selector.current === ONE)).toBe(true);
      owner.text().insert(0, "before. ");
      expect(await runUntil(net.clock, () => peer.text().toString().includes("before."))).toBe(true);

      // The deployed relay runs in process as TWO, and the rotation's waits pass on the network's clock.
      let deployedUrl = "";
      const relayFor = (url: string) => (url === ONE ? ONE : (deployedUrl = url, TWO));
      const ports = ownerPorts(net, world, stubConnection(owner.session), relayFor);
      const harness = rotationDeps(world, ports, relayFor, () => owner.text().insert(0, "during. "));
      const clock = { now: () => world.clock.now(), sleep: async (ms: number) => { world.clock.time += ms; await runFor(net.clock, ms); } };
      const deps = { ...harness.deps, clock };

      await rotateRelay(deps);

      expect(deployedUrl).toBe((await world.store.get())!.relayUrl);
      expect(readRelayList(owner.session.index).map((entry) => entry.url)).toEqual([TWO]);
      // The listing reached the peer through the old relay before the owner left it.
      await runUntil(net.clock, () => peer.text().toString().includes("during."));
      expect(peerState().text).toContain("during.");
      expect(peerState().list).toContain(TWO);

      // The old Worker stops answering, as once it is deleted: the peer moves to the new relay and keeps receiving.
      net.hosts.set(ONE, "limit");
      owner.text().insert(0, "after. ");
      await runUntil(net.clock, () => peer.text().toString().includes("after.") && peer.selector.current === TWO);
      expect(peerState()).toEqual({ text: expect.stringContaining("after. during. before.") as string, current: TWO, list: [TWO] });
    } finally {
      await net.drive(owner.close());
      await net.drive(peer.close());
    }
  });
});

describe("retireRelayIfDue (3.1c)", () => {
  const lock: RelayLock = (run) => run();

  async function rotated(options: WorldOptions = {}, overrides: Partial<RelayAccount> = {}) {
    const world = rotationWorld(options);
    await storeAccount(world, overrides);
    const start = world.clock.now();
    await rotateRelay(rotationDeps(world).deps);
    const retireAfter = (await world.store.get())!.retiring!.retireAfter;
    world.scriptCalls.length = 0;
    world.cloudflare.requests.length = 0;
    return { world, start, retireAfter, deps: { ...world.deps, withLock: lock } };
  }

  it("keeps the old Worker before the grace period ends and deletes only its script once it has", async () => {
    const { world, start, retireAfter, deps } = await rotated();
    expect(retireAfter - start).toBe(RELAY_RETIRE_GRACE_MS);

    world.clock.time = retireAfter - 1;
    await expect(retireRelayIfDue(deps)).resolves.toBe("waiting");
    expect(world.scriptCalls).toEqual([]);
    expect(routes(world).filter((route) => route.startsWith("DELETE"))).toEqual([]);

    world.clock.time = retireAfter;
    await expect(retireRelayIfDue(deps)).resolves.toBe("retired");
    expect(world.scriptCalls).toEqual([`DELETE ${connectedAccount.workerName}`]);
    // The new relay binds the same namespace, so it stays.
    expect(routes(world).filter((route) => route.startsWith("DELETE"))).toEqual(["DELETE /accounts/<A>/workers/scripts/relay"]);
    const account = (await world.store.get())!;
    expect(account.retiring).toBeUndefined();
    expect(account.kvNamespaceId).toBe("kv-1");
    await expect(retireRelayIfDue(deps)).resolves.toBe("none");
  });

  it("deletes the old relay's namespace when it differs from the current relay's", async () => {
    const { world, retireAfter, deps } = await rotated({}, { kvNamespaceId: "kv-old" });
    world.clock.time = retireAfter;
    await expect(retireRelayIfDue(deps)).resolves.toBe("retired");
    expect(routes(world).filter((route) => route.startsWith("DELETE"))).toEqual([
      "DELETE /accounts/<A>/workers/scripts/relay", "DELETE /accounts/<A>/storage/kv/namespaces/kv-old",
    ]);
  });

  it("keeps the retiring relay when the deletion fails", async () => {
    const { world, retireAfter, deps } = await rotated({ failDeletes: true });
    world.clock.time = retireAfter;
    await expect(retireRelayIfDue(deps)).rejects.toThrow();
    expect((await world.store.get())!.retiring?.workerName).toBe(connectedAccount.workerName);
  });

  it("retires a due relay before a new rotation", async () => {
    const { world, retireAfter } = await rotated();
    world.clock.time = retireAfter;
    const { deps } = rotationDeps(world);
    const outcome = await rotateRelay(deps);
    expect(outcome?.kind).toBe("rotated");
    expect(world.scriptCalls).toContain(`DELETE ${connectedAccount.workerName}`);
  });
});

describe("abuse check (D13)", () => {
  const BEFORE_NOON = Date.UTC(2026, 10, 2, 11, 59, 59);
  const AFTER_NOON = Date.UTC(2026, 10, 2, 12, 0, 0);

  it("rotates past 60% before noon UTC, past 80% at any time, or on a limit refusal", () => {
    expect(decideAbuseRotation(60_000, BEFORE_NOON, false)).toBe(false);
    expect(decideAbuseRotation(60_001, BEFORE_NOON, false)).toBe(true);
    expect(decideAbuseRotation(60_001, AFTER_NOON, false)).toBe(false);
    expect(decideAbuseRotation(80_000, AFTER_NOON, false)).toBe(false);
    expect(decideAbuseRotation(80_001, AFTER_NOON, false)).toBe(true);
    expect(decideAbuseRotation(80_001, BEFORE_NOON, false)).toBe(true);
    expect(decideAbuseRotation(0, AFTER_NOON, true)).toBe(true);
  });

  function graphqlWorld(answer: unknown) {
    const world = rotationWorld();
    const queries: string[] = [];
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/graphql")) {
        queries.push((JSON.parse(String(init?.body)) as { query: string }).query);
        return new Response(JSON.stringify(answer), { status: 200 });
      }
      return world.deps.fetch(input, init);
    }) as typeof globalThis.fetch;
    return { world, queries, deps: { ...world.deps, fetch } };
  }

  it("sums the relay script's requests of the current UTC day", async () => {
    const { world, queries, deps } = graphqlWorld({
      data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: 30_000 } }, { sum: { requests: 12_000 } }] }] } }, errors: null,
    });
    await storeAccount(world);
    world.clock.time = Date.UTC(2026, 10, 2, 9, 30);
    await expect(createCloudflareAbuseSignal(deps).requestsToday()).resolves.toBe(42_000);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("workersInvocationsAdaptive");
    expect(queries[0]).toContain(`"${connectedAccount.workerName}"`);
    expect(queries[0]).toContain(`"${connectedAccount.accountId}"`);
    expect(queries[0]).toContain('"2026-11-02T00:00:00.000Z"');
  });

  it("rejects when GraphQL reports errors, and resolves undefined without an account", async () => {
    const { world, deps } = graphqlWorld({ data: null, errors: [{ message: "not authorized for that account" }] });
    await expect(createCloudflareAbuseSignal(deps).requestsToday()).resolves.toBeUndefined();
    await storeAccount(world);
    await expect(createCloudflareAbuseSignal(deps).requestsToday()).rejects.toThrow(/not authorized/);
  });

  it("rotates on a limit refusal without reading analytics, and not below the thresholds", async () => {
    const world = rotationWorld();
    await storeAccount(world);
    world.clock.time = Date.UTC(2026, 10, 2, 13);
    const requestsToday = jest.fn(async () => 70_000);
    const quiet = rotationDeps(world);
    await expect(rotateRelayOnAbuse({ ...quiet.deps, signal: { requestsToday }, limitRefused: false })).resolves.toBeUndefined();
    expect(requestsToday).toHaveBeenCalledTimes(1);
    expect(quiet.calls).toEqual([]);

    requestsToday.mockClear();
    const refused = rotationDeps(world);
    const outcome = await rotateRelayOnAbuse({ ...refused.deps, signal: { requestsToday }, limitRefused: true });
    expect(outcome?.kind).toBe("rotated");
    expect(requestsToday).not.toHaveBeenCalled();
    expect(refused.calls[0]).toBe("lock");
  });
});
