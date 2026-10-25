// The start-up relay update: nothing without an account, an upload for an older build, no tab for a refused sign-in.
import "fake-indexeddb/auto";
import type { ILogger, RelayAccount } from "@labshelf/core";
import { installFakeLocks } from "../support/fakeLocks";
import { fakeRelayCloud, isScriptUpload, RELAY_URL, type FakeRelayCloud } from "./fakeRelayCloud";

const mockCreate = jest.fn();
jest.mock("../../src/platform", () => ({ bx: { tabs: { create: (options: unknown) => mockCreate(options) } } }));

import { openBrowserRelayAccountStore, updateOwnRelayOnStart } from "../../src/relay";
import { relayAccountSlot } from "../../src/relay/browserRelayAccountStore";

const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } satisfies ILogger;
const account: RelayAccount = {
  credential: { kind: "oauth" }, accountId: "acc", relayUrl: RELAY_URL, ownerSecret: "secret", kvNamespaceId: "kv-1",
};
let cloud: FakeRelayCloud;
const realFetch = globalThis.fetch;

async function connectedWith(refreshToken: string): Promise<void> {
  await openBrowserRelayAccountStore(logger).save(account);
  await relayAccountSlot("tokens").store(JSON.stringify({ accessToken: "at-old", refreshToken, expiresAt: 0 }));
}

beforeAll(() => {
  installFakeLocks();
  (globalThis as { RELAY_WORKER_SCRIPT?: string }).RELAY_WORKER_SCRIPT = "export default { fetch() {} }";
});

beforeEach(() => {
  jest.clearAllMocks();
  cloud = fakeRelayCloud();
  globalThis.fetch = cloud.fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await openBrowserRelayAccountStore(logger).forget();
});

it("makes no request when no account is connected", async () => {
  await updateOwnRelayOnStart(logger);
  expect(cloud.requests).toEqual([]);
  expect(logger.error).not.toHaveBeenCalled();
});

it("uploads the bundled Worker over an older relay build", async () => {
  cloud.liveRefreshToken = "rt-live";
  await connectedWith("rt-live");
  cloud.workerBuild = "0.0.1";
  await updateOwnRelayOnStart(logger);
  expect(cloud.requests.some(isScriptUpload)).toBe(true);
  expect(logger.error).not.toHaveBeenCalled();
});

it("opens no sign-in tab when Cloudflare refuses the refresh, and logs the failure", async () => {
  cloud.liveRefreshToken = "rt-live";
  await connectedWith("rt-revoked");
  cloud.workerBuild = "0.0.1";
  await updateOwnRelayOnStart(logger);
  expect(mockCreate).not.toHaveBeenCalled();
  expect(cloud.requests.some(isScriptUpload)).toBe(false);
  expect(logger.error).toHaveBeenCalledWith("relay", expect.objectContaining({ code: "invalid_grant" }), expect.anything());
});
