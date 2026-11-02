// The browser's relay rotation: the Rotate relay action, the hourly abuse check and the retirement of a rotated-out relay, all under the update lock.
import "fake-indexeddb/auto";
import type { ILogger, RelayAccount, RelayClock } from "@labshelf/core";
import { installFakeLocks } from "../support/fakeLocks";
import { fakeRelayCloud, isScriptUpload, RELAY_URL, type FakeRelayCloud } from "./fakeRelayCloud";

jest.mock("../../src/platform", () => ({ bx: {} }));

import {
  checkRelayOnce, createBrowserRelayAccount, openBrowserRelayAccountStore, RELAY_CHECK_INTERVAL_MS, retireOwnRelayIfDue, startRelayChecks,
} from "../../src/relay";
import { createRelayAccountSlot, onRelayRotated } from "../../src/relay/account";

const UPDATE_LOCK = "labshelf:relay-account:update";
const AFTERNOON = Date.UTC(2026, 10, 2, 15);
const HOUR = 60 * 60 * 1000;

const ACCOUNT: RelayAccount = {
  credential: { kind: "oauth" }, accountId: "acc", relayUrl: RELAY_URL, ownerSecret: "secret", kvNamespaceId: "kv-1",
  workerName: "ls-abcdefgh2345", shareWorker: { name: "ls-sharewrkr234", url: "https://ls-sharewrkr234.example.workers.dev", ownerSecret: "share", kvNamespaceId: "kv-2" },
};
const RETIRING = { workerName: "ls-oldrelay2345", relayUrl: "https://ls-oldrelay2345.x.workers.dev", ownerSecret: "old", kvNamespaceId: "kv-1" };

describe("browser relay rotation", () => {
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } satisfies ILogger;
  const realFetch = globalThis.fetch;
  let cloud: FakeRelayCloud;
  let now: number;
  let events: string[];
  let lockHeld: boolean[];
  let fetchedRelayVersion: "ok" | "limit";
  let requestsToday: number;
  const clock: RelayClock = { now: () => now, sleep: async () => undefined };

  /** True when another request for the update lock would have to wait. */
  const updateLockIsHeld = (): Promise<boolean> => navigator.locks.request(UPDATE_LOCK, { ifAvailable: true }, async (lock) => lock === null) as Promise<boolean>;

  const options = () => ({
    logger, clock, fetch: globalThis.fetch,
    offerToShares: async () => { events.push("offer"); lockHeld.push(await updateLockIsHeld()); },
    withdrawFromShares: async (url: string) => { events.push(`withdraw ${url}`); lockHeld.push(await updateLockIsHeld()); },
    hasOpenShare: () => true,
  });

  async function connect(retiring?: { retireAfter: number }): Promise<void> {
    cloud.liveRefreshToken = "rt-live";
    await openBrowserRelayAccountStore(logger).save({ ...ACCOUNT, ...(retiring ? { retiring: { ...RETIRING, ...retiring } } : {}) });
    await createRelayAccountSlot("tokens").store(JSON.stringify({ accessToken: "at-old", refreshToken: "rt-live", expiresAt: 0 }));
  }

  const deletes = () => cloud.requests.filter((request) => request.startsWith("DELETE "));

  beforeAll(() => {
    installFakeLocks();
    (globalThis as { RELAY_WORKER_SCRIPT?: string }).RELAY_WORKER_SCRIPT = "export default { fetch() {} }";
  });

  beforeEach(() => {
    jest.clearAllMocks();
    cloud = fakeRelayCloud();
    now = AFTERNOON;
    events = [];
    lockHeld = [];
    fetchedRelayVersion = "ok";
    requestsToday = 1000;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === `${RELAY_URL}/version` && fetchedRelayVersion === "limit") { return new Response("error code: 1027", { status: 429 }); }
      if (url.endsWith("/graphql")) {
        return new Response(JSON.stringify({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: requestsToday } }] }] } }, errors: null }));
      }
      return cloud.fetch(input, init);
    }) as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    await openBrowserRelayAccountStore(logger).forget();
  });

  describe("the Rotate relay action", () => {
    const relay = () => createBrowserRelayAccount({
      logger, fetch: globalThis.fetch, clock, chooseAccount: async () => undefined, confirmSignInAgain: async () => false,
      offerToShares: options().offerToShares, withdrawFromShares: options().withdrawFromShares,
    });

    it("deploys a new relay, offers it, withdraws the old one, and keeps the old one for a day", async () => {
      await connect();
      const outcome = await relay().rotate();
      expect(outcome).toMatchObject({ kind: "rotated", previousUrl: RELAY_URL, retireAfter: now + 24 * HOUR });
      expect(cloud.requests.some(isScriptUpload)).toBe(true);
      expect(events).toEqual(["offer", `withdraw ${RELAY_URL}`]);
      const stored = await openBrowserRelayAccountStore(logger).get();
      expect(stored?.relayUrl).toBe(cloud.relayUrl());
      expect(stored?.retiring).toMatchObject({ relayUrl: RELAY_URL, retireAfter: now + 24 * HOUR });
    });

    it("offers and withdraws inside the update lock, and releases it afterwards", async () => {
      await connect();
      await relay().rotate();
      expect(lockHeld).toEqual([true, true]);
      expect(await updateLockIsHeld()).toBe(false);
    });

    it("waits for the lock another page holds instead of skipping the rotation", async () => {
      await connect();
      let release = (): void => undefined;
      const held = navigator.locks.request(UPDATE_LOCK, {}, () => new Promise<void>((resolve) => { release = resolve; }));
      const rotation = relay().rotate();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(events).toEqual([]);
      release();
      await held;
      await expect(rotation).resolves.toMatchObject({ kind: "rotated" });
    });

    it("resolves undefined and deploys nothing when no account is connected", async () => {
      await expect(relay().rotate()).resolves.toBeUndefined();
      expect(cloud.requests).toEqual([]);
    });

    it("does not rotate again while the previous relay is still within its grace period", async () => {
      await connect({ retireAfter: now + HOUR });
      await expect(relay().rotate()).resolves.toEqual({ kind: "pending", retireAfter: now + HOUR });
      expect(cloud.requests.some(isScriptUpload)).toBe(false);
      expect(events).toEqual([]);
    });
  });

  describe("the abuse check", () => {
    it("rotates inside the lock when Cloudflare refused the relay for its limit", async () => {
      await connect();
      fetchedRelayVersion = "limit";
      await checkRelayOnce(options());
      expect(events).toEqual(["offer", `withdraw ${RELAY_URL}`]);
      expect(lockHeld).toEqual([true, true]);
    });

    it("rotates when the day's requests pass the threshold, and not below it", async () => {
      await connect();
      await checkRelayOnce(options());
      expect(events).toEqual([]);
      expect(cloud.requests.some(isScriptUpload)).toBe(false);
      requestsToday = 90_000;
      await checkRelayOnce(options());
      expect(events).toEqual(["offer", `withdraw ${RELAY_URL}`]);
    });

    it("calls the updates registered with onRelayRotated after an abuse rotation, as the command rotation does", async () => {
      await connect();
      fetchedRelayVersion = "limit";
      const changes: Array<{ previousUrl: string; relayUrl: string }> = [];
      const stop = onRelayRotated(async (change) => { changes.push(change); });
      try {
        await checkRelayOnce(options());
      } finally {
        stop();
      }
      expect(changes).toEqual([{ previousUrl: RELAY_URL, relayUrl: cloud.relayUrl() }]);
    });

    it("does not fail the rotation, nor skip the other updates, when one registered update throws", async () => {
      await connect();
      fetchedRelayVersion = "limit";
      const changes: Array<{ previousUrl: string; relayUrl: string }> = [];
      const stopFailing = onRelayRotated(async () => { throw new Error("directory down"); }, logger);
      const stop = onRelayRotated(async (change) => { changes.push(change); }, logger);
      try {
        await checkRelayOnce(options());
      } finally {
        stop();
        stopFailing();
      }
      expect(changes).toEqual([{ previousUrl: RELAY_URL, relayUrl: cloud.relayUrl() }]);
      expect(logger.error).toHaveBeenCalledWith("relay", expect.objectContaining({ message: "directory down" }), expect.anything());
    });

    it("skips the check while no share is open", async () => {
      await connect();
      fetchedRelayVersion = "limit";
      await checkRelayOnce({ ...options(), hasOpenShare: () => false });
      expect(events).toEqual([]);
      expect(cloud.requests).toEqual([]);
    });

    it("logs a failing check instead of throwing", async () => {
      await connect();
      requestsToday = Number.NaN;
      globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
      await expect(checkRelayOnce({ ...options(), fetch: globalThis.fetch })).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });

    it("runs every hour and stops when asked", () => {
      const callbacks: Array<() => void> = [];
      const setIntervalSpy = jest.spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void) => { callbacks.push(callback); return 7; }) as never);
      const clearIntervalSpy = jest.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);
      try {
        const stop = startRelayChecks(options());
        expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), RELAY_CHECK_INTERVAL_MS);
        expect(RELAY_CHECK_INTERVAL_MS).toBe(HOUR);
        stop();
        expect(clearIntervalSpy).toHaveBeenCalledWith(7);
      } finally {
        setIntervalSpy.mockRestore();
        clearIntervalSpy.mockRestore();
      }
    });
  });

  describe("retiring a rotated-out relay", () => {
    it("keeps the relay until its retireAfter and deletes it from then on, at start-up", async () => {
      await connect({ retireAfter: now + 1000 });
      await expect(retireOwnRelayIfDue(logger, { clock, fetch: globalThis.fetch })).resolves.toBe("waiting");
      expect(deletes()).toEqual([]);
      now += 1000;
      await expect(retireOwnRelayIfDue(logger, { clock, fetch: globalThis.fetch })).resolves.toBe("retired");
      expect(deletes().some((request) => request.includes(RETIRING.workerName))).toBe(true);
      expect((await openBrowserRelayAccountStore(logger).get())?.retiring).toBeUndefined();
    });

    it("retires on the hourly tick too, with the update lock free afterwards", async () => {
      await connect({ retireAfter: now - 1 });
      await checkRelayOnce({ ...options(), hasOpenShare: () => false });
      expect(deletes().some((request) => request.includes(RETIRING.workerName))).toBe(true);
      expect((await openBrowserRelayAccountStore(logger).get())?.retiring).toBeUndefined();
      expect(await updateLockIsHeld()).toBe(false);
    });

    it("waits for the update lock another page holds", async () => {
      await connect({ retireAfter: now - 1 });
      let release = (): void => undefined;
      const held = navigator.locks.request(UPDATE_LOCK, {}, () => new Promise<void>((resolve) => { release = resolve; }));
      const retirement = retireOwnRelayIfDue(logger, { clock, fetch: globalThis.fetch });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(deletes()).toEqual([]);
      release();
      await held;
      await expect(retirement).resolves.toBe("retired");
    });

    it("does nothing without an account", async () => {
      await expect(retireOwnRelayIfDue(logger, { clock, fetch: globalThis.fetch })).resolves.toBe("none");
      expect(cloud.requests).toEqual([]);
    });
  });
});
