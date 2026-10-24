// Builds a relay account store over memory slots, with one fetch that serves the Cloudflare API, its OAuth server and the relay.
import { createRelayAccountStore, createStoredLock, type RelayAccount, type RelayAccountDeps } from "../../../src/relay/index";
import { ACCOUNT, fakeCloudflare, recordingLogger, type FakeCloudflareOptions } from "../client/fakeCloudflare";
import { fakeClock, fakeOAuthServer, memorySlot } from "../oauth/fakeOAuthServer";

const API = "https://api.cloudflare.com/client/v4";
const OAUTH = "https://dash.cloudflare.com/oauth2/";
const KV_NAMESPACES = /\/storage\/kv\/namespaces$/;

export interface WorldOptions extends FakeCloudflareOptions {
  /** The relay address never answers, so the wait for it times out. */
  relayNeverAnswers?: boolean;
  /** Every DELETE fails with a permission error. */
  failDeletes?: boolean;
  /** GET /accounts answers these instead of the fake's one account. */
  accounts?: { id: string; name: string }[];
}

export const fail = (status: number, code: number, message: string) =>
  new Response(JSON.stringify({ success: false, errors: [{ code, message }], result: null }), { status });

export function accountWorld(options: WorldOptions = {}) {
  const oauth = fakeOAuthServer();
  const clock = fakeClock();
  const logger = recordingLogger();
  // Remembers created namespaces like the real API, so a retried deploy can find the one a failed deploy left.
  const cloudflareOptions: FakeCloudflareOptions = { hasSubdomain: true, validToken: "access-1", existingKvNamespaces: [], ...options };
  const cloudflare = fakeCloudflare(cloudflareOptions);
  const account = memorySlot();
  const tokens = memorySlot();
  const lockSlot = memorySlot();
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(OAUTH)) { return oauth.fetch(input, init); }
    if (!url.startsWith(API) && options.relayNeverAnswers) { throw new TypeError("fetch failed"); }
    if (options.accounts && url === `${API}/accounts`) {
      return new Response(JSON.stringify({ success: true, errors: [], result: options.accounts }), { status: 200 });
    }
    if (init?.method === "DELETE" && options.failDeletes) { return fail(403, 10000, "Authentication error"); }
    // The fake routes the Worker named "relay"; the account workflows deploy "labshelf-relay".
    const response = await cloudflare.fetch(url.replace("/workers/scripts/labshelf-relay", "/workers/scripts/relay"), init);
    if (init?.method === "POST" && KV_NAMESPACES.test(url) && response.ok) {
      cloudflareOptions.existingKvNamespaces?.push({ id: "kv-1", title: (JSON.parse(String(init.body)) as { title: string }).title });
    }
    return response;
  }) as typeof globalThis.fetch;
  const store = createRelayAccountStore({ account, tokens, refreshLock: createStoredLock(lockSlot, clock) }, logger);
  const signInAgain = jest.fn<Promise<boolean>, [unknown]>(async () => false);
  const deps: RelayAccountDeps = { store, fetch, logger, clock, signInAgain };
  return { oauth, clock, logger, cloudflare, cloudflareOptions, slots: { account, tokens, lockSlot }, store, deps, signInAgain };
}

export type World = ReturnType<typeof accountWorld>;

/** Stores tokens as a finished sign-in leaves them; `expired` makes the next use refresh with the live `refresh-0`. */
export function signIn(world: World, expired = false): void {
  world.oauth.liveRefresh.add("refresh-0");
  const expiresAt = expired ? world.clock.now() - 1 : world.clock.now() + 3_600_000;
  world.slots.tokens.value = JSON.stringify({ accessToken: expired ? "access-0" : "access-1", refreshToken: "refresh-0", expiresAt });
}

export const connectedAccount: RelayAccount = {
  credential: { kind: "oauth" }, accountId: ACCOUNT, relayUrl: "https://labshelf-relay.lab.workers.dev", ownerSecret: "owner-SECRET", kvNamespaceId: "kv-1",
};

export const routes = (world: World) => world.cloudflare.requests
  .filter((request) => request.path.startsWith("/"))
  .map((request) => `${request.method} ${request.path.replace(ACCOUNT, "<A>").replace(/\?.*$/, "")}`);
