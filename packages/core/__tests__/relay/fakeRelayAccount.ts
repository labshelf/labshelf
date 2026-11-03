// Builds a relay account store over memory slots, with one fetch that serves the Cloudflare API, its OAuth server and the relay.
// The fake Cloudflare knows one script, "relay"; this world routes every random `ls-` name to it and records each script's
// upload and secret by its real name, so a test tells the relay Worker from the share Worker.
import { createRelayAccountStore, createStoredLock, type RelayAccount, type RelayAccountDeps } from "../../src/relay/index";
import { ACCOUNT, fakeCloudflare, recordingLogger, type FakeCloudflareOptions } from "./fakeCloudflare";
import { fakeClock, fakeOAuthServer, memorySlot } from "./fakeOAuthServer";

const API = "https://api.cloudflare.com/client/v4";
const OAUTH = "https://dash.cloudflare.com/oauth2/";
const KV_NAMESPACES = /\/storage\/kv\/namespaces$/;
const WORKER_SCRIPT = /\/workers\/scripts\/(ls-[a-z2-7]{12})/;

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
  /** `<method> <script name>` of every call on a Worker script, before the fake's renaming. */
  const scriptCalls: string[] = [];
  /** The upload form and the owner secret each script name received. */
  const scripts = new Map<string, { form?: FormData; secret?: string }>();
  /** Each new namespace gets the next id, so the relay's and the share Worker's namespaces differ. */
  let createdNamespaces = 0;
  const recordScript = (name: string, url: string, init: RequestInit) => {
    const entry = scripts.get(name) ?? {};
    if (url.endsWith("/secrets")) { entry.secret = (JSON.parse(String(init.body)) as { text: string }).text; }
    if (init.body instanceof FormData) { entry.form = init.body; }
    scripts.set(name, entry);
  };
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(OAUTH)) { return oauth.fetch(input, init); }
    if (!url.startsWith(API) && options.relayNeverAnswers) { throw new TypeError("fetch failed"); }
    if (options.accounts && url === `${API}/accounts`) {
      return new Response(JSON.stringify({ success: true, errors: [], result: options.accounts }), { status: 200 });
    }
    if (init?.method === "DELETE" && options.failDeletes) { return fail(403, 10000, "Authentication error"); }
    // The fake routes the Worker named "relay"; the account workflows deploy a random `ls-` name.
    const script = WORKER_SCRIPT.exec(url)?.[1];
    if (script) { scriptCalls.push(`${init?.method ?? "GET"} ${script}`); }
    const response = await cloudflare.fetch(url.replace(WORKER_SCRIPT, "/workers/scripts/relay"), init);
    if (script && init?.method === "PUT" && response.ok) { recordScript(script, url, init); }
    if (init?.method === "POST" && KV_NAMESPACES.test(url) && response.ok) {
      createdNamespaces += 1;
      const id = `kv-${createdNamespaces}`;
      cloudflareOptions.existingKvNamespaces?.push({ id, title: (JSON.parse(String(init.body)) as { title: string }).title });
      return new Response(JSON.stringify({ success: true, errors: [], result: { id } }), { status: 200 });
    }
    return response;
  }) as typeof globalThis.fetch;
  const store = createRelayAccountStore({ account, tokens, refreshLock: createStoredLock(lockSlot, clock) }, logger);
  const signInAgain = jest.fn<Promise<boolean>, [unknown]>(async () => false);
  const deps: RelayAccountDeps = { store, fetch, logger, clock, signInAgain };
  return { oauth, clock, logger, cloudflare, cloudflareOptions, slots: { account, tokens, lockSlot }, store, deps, signInAgain, scriptCalls, scripts };
}

export type World = ReturnType<typeof accountWorld>;

/** Stores tokens as a finished sign-in leaves them; `expired` makes the next use refresh with the live `refresh-0`. */
export function signIn(world: World, expired = false): void {
  world.oauth.liveRefresh.add("refresh-0");
  const expiresAt = expired ? world.clock.now() - 1 : world.clock.now() + 3_600_000;
  world.slots.tokens.value = JSON.stringify({ accessToken: expired ? "access-0" : "access-1", refreshToken: "refresh-0", expiresAt });
}

export const connectedAccount: RelayAccount = {
  credential: { kind: "oauth" }, accountId: ACCOUNT, workerName: "ls-abcdefgh2345", relayUrl: "https://ls-abcdefgh2345.lab.workers.dev",
  ownerSecret: "owner-SECRET", kvNamespaceId: "kv-1",
  shareWorker: { name: "ls-sharewrkr234", url: "https://ls-sharewrkr234.lab.workers.dev", ownerSecret: "share-SECRET", kvNamespaceId: "kv-2" },
};

export const routes = (world: World) => world.cloudflare.requests
  .filter((request) => request.path.startsWith("/"))
  .map((request) => `${request.method} ${request.path.replace(ACCOUNT, "<A>").replace(/\?.*$/, "")}`);
