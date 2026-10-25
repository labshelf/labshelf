// The browser's relay account workflow: tab sign-in, deploy, one page at a time, restart, retry and disconnect.
import "fake-indexeddb/auto";
import { CLOUDFLARE_REDIRECT_URI, type ILogger } from "@labshelf/core";
import { installFakeLocks } from "../support/fakeLocks";
import { fakeRelayCloud, isScriptUpload, RELAY_URL, type FakeRelayCloud } from "./fakeRelayCloud";

type UpdatedListener = (tabId: number, change: { url?: string }, tab: { id?: number; url?: string }) => void;
type RemovedListener = (tabId: number) => void;

const mockUpdated = new Set<UpdatedListener>();
const mockRemoved = new Set<RemovedListener>();
/** What the owner does in the sign-in tab once it opens. */
let mockTabAction: "allow" | "close" = "allow";
let mockTabs = 0;
const mockCreate = jest.fn(async ({ url }: { url: string }) => {
  mockTabs += 1;
  const tabId = mockTabs;
  setImmediate(() => {
    if (mockTabAction === "close") { for (const l of [...mockRemoved]) { l(tabId); } return; }
    const state = new URL(url).searchParams.get("state") ?? "";
    const redirect = `${CLOUDFLARE_REDIRECT_URI}?code=c${tabId}&state=${state}`;
    for (const l of [...mockUpdated]) { l(tabId, { url: redirect }, { id: tabId, url: redirect }); }
  });
  return { id: tabId, url };
});
const mockPermissionRequest = jest.fn(async (_request: { origins: string[] }) => true);

jest.mock("../../src/platform", () => ({
  bx: {
    permissions: { request: (request: { origins: string[] }) => mockPermissionRequest(request) },
    tabs: {
      create: (options: { url: string }) => mockCreate(options),
      remove: async () => undefined,
      onUpdated: { addListener: (l: UpdatedListener) => mockUpdated.add(l), removeListener: (l: UpdatedListener) => mockUpdated.delete(l) },
      onRemoved: { addListener: (l: RemovedListener) => mockRemoved.add(l), removeListener: (l: RemovedListener) => mockRemoved.delete(l) },
    },
  },
}));

import { createBrowserRelayAccount, RelayAccountBusyError, RelaySignInCancelledError } from "../../src/relay";
import { createRelayAccountSlot } from "../../src/relay/browserRelayAccountStore";

const logger: ILogger = { log: async () => undefined, error: async () => undefined };
let cloud: FakeRelayCloud;
let events: string[];

function account() {
  return createBrowserRelayAccount({
    logger, fetch: cloud.fetch,
    chooseAccount: async () => { throw new Error("one account needs no choice"); },
    offerToShares: async () => { events.push("offer"); },
    withdrawFromShares: async () => undefined,
    confirmSignInAgain: async () => true,
  });
}

const slots = async () => [await createRelayAccountSlot("account").get(), await createRelayAccountSlot("tokens").get()];
const kvCreations = () => cloud.requests.filter((r) => r.startsWith("POST ") && r.endsWith("/storage/kv/namespaces")).length;

beforeAll(() => {
  installFakeLocks();
  (globalThis as { RELAY_WORKER_SCRIPT?: string }).RELAY_WORKER_SCRIPT = "export default { fetch() {} }";
});

beforeEach(() => {
  jest.clearAllMocks();
  mockTabAction = "allow";
  cloud = fakeRelayCloud();
  events = [];
});

afterEach(async () => {
  await createRelayAccountSlot("account").delete();
  await createRelayAccountSlot("tokens").delete();
});

it("signs in through a tab, deploys, stores the account and offers it to the shares once", async () => {
  const relay = account();
  expect(await relay.connect()).toBe(RELAY_URL);
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(cloud.requests.some(isScriptUpload)).toBe(true);
  expect(events).toEqual(["offer"]);
  expect(await relay.status()).toEqual({ relayUrl: RELAY_URL });
});

const LOOPBACK_REFUSED = "LabShelf needs access to 127.0.0.1 to finish signing in to Cloudflare. "
  + "Allow it in the add-on's site access settings and try again.";

it("asks for access to the loopback redirect before opening the sign-in tab", async () => {
  await account().connect();
  expect(mockPermissionRequest).toHaveBeenCalledWith({ origins: ["http://127.0.0.1/*"] });
  expect(mockPermissionRequest.mock.invocationCallOrder[0]).toBeLessThan(mockCreate.mock.invocationCallOrder[0] ?? 0);
});

it("fails at once without a tab when the owner refuses access to the loopback redirect", async () => {
  mockPermissionRequest.mockResolvedValueOnce(false);
  await expect(account().connect()).rejects.toThrow(LOOPBACK_REFUSED);
  expect(mockCreate).not.toHaveBeenCalled();
  expect(cloud.requests).toEqual([]);
});

it("refuses a second connect while another page holds the lifecycle lock", async () => {
  let release = (): void => undefined;
  const held = navigator.locks.request("labshelf:relay-account:lifecycle", {}, () => new Promise<void>((r) => { release = r; }));
  await expect(account().connect()).rejects.toBeInstanceOf(RelayAccountBusyError);
  expect(mockCreate).not.toHaveBeenCalled();
  expect(cloud.requests).toEqual([]);
  release();
  await held;
});

it("returns the stored relay without a sign-in when already connected", async () => {
  await account().connect();
  mockCreate.mockClear();
  cloud.requests.length = 0;
  expect(await account().connect()).toBe(RELAY_URL);
  expect(mockCreate).not.toHaveBeenCalled();
  expect(cloud.requests).toEqual([]);
});

it("leaves no tokens or account when the owner closes the sign-in tab", async () => {
  mockTabAction = "close";
  await expect(account().connect()).rejects.toBeInstanceOf(RelaySignInCancelledError);
  expect(await slots()).toEqual([undefined, undefined]);
  expect(cloud.requests).toEqual([]);
});

it("refreshes an expired access token once after a restart, then disconnects", async () => {
  await account().connect();
  const tokens = JSON.parse((await createRelayAccountSlot("tokens").get()) ?? "{}") as Record<string, unknown>;
  await createRelayAccountSlot("tokens").store(JSON.stringify({ ...tokens, expiresAt: 0 }));
  cloud.requests.length = 0;
  expect(await account().disconnect()).toEqual({ relayUrl: RELAY_URL });
  expect(cloud.requests.filter((r) => r.endsWith("/oauth2/token"))).toHaveLength(1);
  expect(cloud.requests.some((r) => r.startsWith("DELETE "))).toBe(true);
});

it("reuses the KV namespace when a deploy that failed is retried", async () => {
  cloud.failScriptUpload = true;
  await expect(account().connect()).rejects.toThrow();
  expect(await slots()).toEqual([undefined, undefined]);
  cloud.failScriptUpload = false;
  expect(await account().connect()).toBe(RELAY_URL);
  expect(kvCreations()).toBe(1);
});

it("withdraws the relay from the shares before deleting it, then forgets the credentials", async () => {
  const relay = account();
  await relay.connect();
  cloud.requests.length = 0;
  const firstDelete = (): number => cloud.requests.findIndex((r) => r.startsWith("DELETE "));
  const withdrawnBefore: number[] = [];
  const watched = createBrowserRelayAccount({
    logger, fetch: cloud.fetch, chooseAccount: async () => undefined, offerToShares: async () => undefined, confirmSignInAgain: async () => true,
    withdrawFromShares: async () => { withdrawnBefore.push(firstDelete()); },
  });
  await watched.disconnect();
  expect(withdrawnBefore).toEqual([-1]);
  expect(firstDelete()).toBeGreaterThanOrEqual(0);
  expect(await relay.status()).toBeUndefined();
  expect(await slots()).toEqual([undefined, undefined]);
});
