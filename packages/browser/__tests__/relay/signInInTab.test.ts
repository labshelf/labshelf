// Cloudflare sign-in in a watched tab: the redirect match, cancellation, timeout and the stored tokens.
import { CloudflareOAuthError, CLOUDFLARE_REDIRECT_URI, type ILogger, type RelayAccountStore, type SecretSlot } from "@labshelf/core";

type UpdatedListener = (tabId: number, change: { url?: string }, tab: { id?: number; url?: string }) => void;
type RemovedListener = (tabId: number) => void;

function fakeEvent<L>() {
  const listeners = new Set<L>();
  return {
    listeners,
    addListener: (listener: L) => { listeners.add(listener); },
    removeListener: (listener: L) => { listeners.delete(listener); },
  };
}

const TAB_ID = 7;
const mockUpdated = fakeEvent<UpdatedListener>();
const mockRemoved = fakeEvent<RemovedListener>();
let mockOpenedUrl = "";
const mockCreate = jest.fn(async ({ url }: { url: string }) => { mockOpenedUrl = url; return { id: TAB_ID, url }; });
const mockRemove = jest.fn(async (_tabId: number) => undefined);

jest.mock("../../src/platform", () => ({
  bx: {
    tabs: {
      create: (options: { url: string }) => mockCreate(options),
      remove: (tabId: number) => mockRemove(tabId),
      onUpdated: mockUpdated,
      onRemoved: mockRemoved,
    },
  },
}));

import { RelaySignInCancelledError, signInInTab } from "../../src/relay";

const logger: ILogger = { log: async () => undefined, error: async () => undefined };

function memorySlot(): SecretSlot & { value?: string } {
  const slot: SecretSlot & { value?: string } = {
    get: async () => slot.value,
    store: async (value) => { slot.value = value; },
    delete: async () => { delete slot.value; },
  };
  return slot;
}

const tokenFetch = jest.fn(async (url: string) => {
  expect(url).toBe("https://dash.cloudflare.com/oauth2/token");
  return new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }), { status: 200 });
});

let tokens: ReturnType<typeof memorySlot>;
const store = (): RelayAccountStore => ({ tokens } as unknown as RelayAccountStore);

/** Resolves once the sign-in watches its tab. */
async function watching(): Promise<void> {
  while (mockUpdated.listeners.size === 0) { await new Promise((r) => setImmediate(r)); }
}

const stateOf = () => new URL(mockOpenedUrl).searchParams.get("state") ?? "";
const navigate = (tabId: number, url: string) => { for (const l of [...mockUpdated.listeners]) { l(tabId, { url }, { id: tabId, url }); } };
const listenerCount = () => mockUpdated.listeners.size + mockRemoved.listeners.size;

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdated.listeners.clear();
  mockRemoved.listeners.clear();
  tokens = memorySlot();
});

const start = (signal?: AbortSignal) => signInInTab({ store: store(), fetch: tokenFetch as unknown as typeof fetch, logger, signal });

it("stores the tokens, closes the tab and removes its listeners", async () => {
  const done = start();
  await watching();
  navigate(TAB_ID, `${CLOUDFLARE_REDIRECT_URI}?code=abc&state=${stateOf()}`);
  await done;
  expect(JSON.parse(tokens.value ?? "{}")).toMatchObject({ accessToken: "at", refreshToken: "rt" });
  expect(mockRemove).toHaveBeenCalledWith(TAB_ID);
  expect(listenerCount()).toBe(0);
});

it("rejects a redirect with another state before any token request", async () => {
  const done = start();
  await watching();
  navigate(TAB_ID, `${CLOUDFLARE_REDIRECT_URI}?code=abc&state=forged`);
  await expect(done).rejects.toMatchObject({ code: "state_mismatch" });
  expect(tokenFetch).not.toHaveBeenCalled();
  expect(tokens.value).toBeUndefined();
});

it("ignores the redirect in another tab and lookalike addresses", async () => {
  const done = start();
  await watching();
  const query = `?code=abc&state=${stateOf()}`;
  navigate(99, `${CLOUDFLARE_REDIRECT_URI}${query}`);
  navigate(TAB_ID, `http://127.0.0.1:8977/callback${query}`);
  navigate(TAB_ID, `${CLOUDFLARE_REDIRECT_URI}X${query}`);
  navigate(TAB_ID, "not a url");
  await new Promise((r) => setTimeout(r, 0));
  expect(tokenFetch).not.toHaveBeenCalled();
  navigate(TAB_ID, `${CLOUDFLARE_REDIRECT_URI}${query}`);
  await done;
  expect(tokenFetch).toHaveBeenCalledTimes(1);
});

it("reports a cancelled sign-in when the user closes the tab, without closing it again", async () => {
  const done = start();
  await watching();
  for (const l of [...mockRemoved.listeners]) { l(TAB_ID); }
  await expect(done).rejects.toBeInstanceOf(RelaySignInCancelledError);
  expect(mockRemove).not.toHaveBeenCalled();
  expect(listenerCount()).toBe(0);
});

it("reports a cancelled sign-in on abort and closes the tab", async () => {
  const controller = new AbortController();
  const done = start(controller.signal);
  await watching();
  controller.abort();
  await expect(done).rejects.toBeInstanceOf(RelaySignInCancelledError);
  expect(mockRemove).toHaveBeenCalledWith(TAB_ID);
});

it("gives up after 10 minutes", async () => {
  jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick", "queueMicrotask"] });
  try {
    const done = start();
    await watching();
    jest.advanceTimersByTime(10 * 60_000);
    await expect(done).rejects.toThrow("the Cloudflare sign-in did not come back within 10 minutes");
    expect(mockRemove).toHaveBeenCalledWith(TAB_ID);
    expect(listenerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

it("surfaces Cloudflare's refusal with the right state", async () => {
  const done = start();
  await watching();
  navigate(TAB_ID, `${CLOUDFLARE_REDIRECT_URI}?error=access_denied&state=${stateOf()}`);
  const error = await done.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CloudflareOAuthError);
  expect(error).toMatchObject({ code: "access_denied" });
  expect(tokenFetch).not.toHaveBeenCalled();
});
