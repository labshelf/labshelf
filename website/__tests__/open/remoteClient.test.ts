// Pins how the /open/ page finds the owner's Worker and opens a mirror session on it, and how the answers map to page states.
import { openRemoteLibrary, type OpenState } from "../../src/open/remoteClient";

const ACCESS_TOKEN = "cf-access-token-0123456789";
const RELAY = "https://labshelf-relay-abc123.owner.workers.dev";
const SESSION = "session-token-xyz";

interface Seen { method: string; url: URL; headers: Headers; body: string }

interface Setup {
  /** Undefined answers the directory's not_found. */
  relayUrl?: string | undefined;
  /** What POST <relay>/mirror/session answers; a Response, or an error to throw from fetch. */
  session?: () => Response | never;
  rows?: { path: string; kind: string; hash: string; size: number; updated: number }[];
  files?: Record<string, string>;
  directory?: () => Response | never;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeRelay(setup: Setup) {
  const seen: Seen[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const headers = new Headers(init?.headers);
    const method = (init?.method ?? "GET").toUpperCase();
    seen.push({ method, url, headers, body: String(init?.body ?? "") });
    if (url.origin === "https://labshelf.org" && url.pathname === "/api/directory/self") {
      if (setup.directory) { return setup.directory(); }
      return setup.relayUrl === undefined ? json({ error: "not_found" }, 404) : json({ relayUrl: setup.relayUrl });
    }
    if (url.origin === RELAY && url.pathname === "/mirror/session" && method === "POST") {
      return setup.session ? setup.session() : json({ session: SESSION, expires: 1_900_000_000_000 });
    }
    if (url.origin === RELAY && headers.get("authorization") !== `Bearer ${SESSION}`) { return json({ error: "unauthorized" }, 401); }
    if (url.origin === RELAY && url.pathname === "/mirror/index" && method === "GET") { return json(setup.rows ?? []); }
    if (url.origin === RELAY && url.pathname.startsWith("/mirror/file/") && method === "GET") {
      const path = decodeURIComponent(url.pathname.slice("/mirror/file/".length));
      const value = setup.files?.[path];
      return value === undefined ? json({ error: "not_found" }, 404) : new Response(value, { status: 200 });
    }
    throw new Error(`unexpected request ${method} ${url.href}`);
  }) as typeof fetch;
  return { fetch: fakeFetch, seen };
}

async function ready(setup: Setup) {
  const relay = fakeRelay(setup);
  const state = await openRemoteLibrary(ACCESS_TOKEN, { fetch: relay.fetch });
  if (state.kind !== "ready") { throw new Error(`expected ready, got ${state.kind}`); }
  return { client: state.client, relay };
}

const stateOf = async (setup: Setup): Promise<{ state: OpenState; relay: ReturnType<typeof fakeRelay> }> => {
  const relay = fakeRelay(setup);
  return { state: await openRemoteLibrary(ACCESS_TOKEN, { fetch: relay.fetch }), relay };
};

const relayCalls = (relay: ReturnType<typeof fakeRelay>) => relay.seen.filter((call) => call.url.origin === RELAY);

describe("openRemoteLibrary: finding the Worker and opening a session", () => {
  it("5.1c asks the directory for the caller's own relay URL with the access token as bearer", async () => {
    const { relay } = await ready({ relayUrl: RELAY });
    const self = relay.seen.find((call) => call.url.pathname === "/api/directory/self");
    expect(self?.method).toBe("POST");
    expect(self?.url.origin).toBe("https://labshelf.org");
    expect(self?.headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it("5.1c posts the access token to the relay's /mirror/session", async () => {
    const { relay } = await ready({ relayUrl: RELAY });
    const session = relay.seen.find((call) => call.url.pathname === "/mirror/session");
    expect(session?.method).toBe("POST");
    expect(session?.url.origin).toBe(RELAY);
    expect(JSON.parse(session?.body ?? "{}")).toEqual({ accessToken: ACCESS_TOKEN });
  });

  it("5.1c asks the directory before the relay", async () => {
    const { relay } = await ready({ relayUrl: RELAY });
    const order = relay.seen.map((call) => call.url.pathname);
    expect(order.indexOf("/api/directory/self")).toBeLessThan(order.indexOf("/mirror/session"));
  });
});

describe("openRemoteLibrary: states", () => {
  it("5.1c maps a relay that answers off to the off state and reads nothing", async () => {
    const { state, relay } = await stateOf({ relayUrl: RELAY, session: () => json({ error: "off" }, 403) });
    expect(state.kind).toBe("off");
    expect(relayCalls(relay).map((call) => call.url.pathname)).toEqual(["/mirror/session"]);
  });

  it("5.1c maps a relay that answers other_account to the other_account state and reads nothing", async () => {
    const { state, relay } = await stateOf({ relayUrl: RELAY, session: () => json({ error: "other_account" }, 403) });
    expect(state.kind).toBe("other_account");
    expect(relayCalls(relay).map((call) => call.url.pathname)).toEqual(["/mirror/session"]);
  });

  it("5.1c maps a directory not_found to the not_registered state and never calls a relay", async () => {
    const { state, relay } = await stateOf({ relayUrl: undefined });
    expect(state.kind).toBe("not_registered");
    expect(relayCalls(relay)).toEqual([]);
  });

  it("5.1c maps a session that is a success to ready", async () => {
    const { state } = await stateOf({ relayUrl: RELAY });
    expect(state.kind).toBe("ready");
  });

  it("5.1c answers failed with a message, and does not throw, when the relay cannot be reached", async () => {
    const { state } = await stateOf({ relayUrl: RELAY, session: () => { throw new TypeError("network down"); } });
    expect(state.kind).toBe("failed");
    expect(state.kind === "failed" && typeof state.message === "string" && state.message.length > 0).toBe(true);
  });

  it("5.1c answers failed, and does not throw, when the directory is unavailable", async () => {
    const { state } = await stateOf({ directory: () => json({ error: "unavailable" }, 503) });
    expect(state.kind).toBe("failed");
  });
});

describe("the remote library client", () => {
  const ROWS = [
    { path: "index/papers.json", kind: "papers", hash: "h1", size: 120, updated: 1_790_000_000_000 },
    { path: "papers/ml/vaswani2017/notes.qmd", kind: "notes", hash: "h2", size: 42, updated: 1_790_000_001_000 },
    { path: "projects/My Thesis/main.tex", kind: "source", hash: "h3", size: 9, updated: 1_790_000_002_000 },
  ];

  it("5.1c reads the index from GET /mirror/index with the session token, not the access token", async () => {
    const { client, relay } = await ready({ relayUrl: RELAY, rows: ROWS });
    await client.index();
    const read = relay.seen.find((call) => call.url.pathname === "/mirror/index");
    expect(read?.method).toBe("GET");
    expect(read?.headers.get("authorization")).toBe(`Bearer ${SESSION}`);
  });

  it("5.1c lists each row's path, kind, size and updated time", async () => {
    const { client } = await ready({ relayUrl: RELAY, rows: ROWS });
    const rows = await client.index();
    expect(rows.map(({ path, kind, size, updated }) => ({ path, kind, size, updated }))).toEqual(
      ROWS.map(({ path, kind, size, updated }) => ({ path, kind, size, updated })),
    );
  });

  it("5.1c reads a file as its text from GET /mirror/file/<path> with the session token", async () => {
    const { client, relay } = await ready({ relayUrl: RELAY, files: { "papers/ml/vaswani2017/notes.qmd": "# Attention\n\nNotes.\n" } });
    await expect(client.file("papers/ml/vaswani2017/notes.qmd")).resolves.toBe("# Attention\n\nNotes.\n");
    const read = relay.seen.find((call) => call.url.pathname.startsWith("/mirror/file/"));
    expect(read?.method).toBe("GET");
    expect(read?.headers.get("authorization")).toBe(`Bearer ${SESSION}`);
  });

  it("5.1c reads a path with a space in it", async () => {
    const { client } = await ready({ relayUrl: RELAY, files: { "projects/My Thesis/main.tex": "\\documentclass{article}" } });
    await expect(client.file("projects/My Thesis/main.tex")).resolves.toBe("\\documentclass{article}");
  });

  it("5.1c returns the paper index file as raw text, unparsed", async () => {
    const raw = "{\"papers\":[],\"folders\":[]}";
    const { client } = await ready({ relayUrl: RELAY, files: { "index/papers.json": raw } });
    await expect(client.file("index/papers.json")).resolves.toBe(raw);
  });

  it("5.1c rejects the read of a file the Worker does not have", async () => {
    const { client } = await ready({ relayUrl: RELAY, files: {} });
    await expect(client.file("papers/none/notes.qmd")).rejects.toBeDefined();
  });

  it("5.1c never sends the Cloudflare access token to the relay after the session is opened", async () => {
    const { client, relay } = await ready({ relayUrl: RELAY, rows: ROWS, files: { "index/papers.json": "{}" } });
    await client.index();
    await client.file("index/papers.json");
    const afterSession = relayCalls(relay).filter((call) => call.url.pathname !== "/mirror/session");
    expect(afterSession.length).toBeGreaterThanOrEqual(2);
    for (const call of afterSession) {
      expect(call.headers.get("authorization")).not.toContain(ACCESS_TOKEN);
      expect(call.body).not.toContain(ACCESS_TOKEN);
      expect(call.url.href).not.toContain(ACCESS_TOKEN);
    }
  });
});
