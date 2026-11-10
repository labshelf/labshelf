// Tests the directory client against a fake fetch: each endpoint's request and answer, and the mapping of every contract error.
import { createDirectoryClient, DirectoryError, DIRECTORY_URL } from "../../src/share/index";
import { fingerprint, generateIdentity, publicKeys } from "../../src/collab/index";

interface Seen { url: string; method: string; auth: string | null; body: unknown }

function fakeFetch(answer: (url: string, body: unknown) => { status: number; json: unknown } | "network") {
  const seen: Seen[] = [];
  const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" && init.body !== "" ? JSON.parse(init.body) : undefined;
    seen.push({ url, method: init?.method ?? "GET", auth: headers.get("authorization"), body });
    const result = answer(url, body);
    if (result === "network") { throw new TypeError("Failed to fetch"); }
    return new Response(JSON.stringify(result.json), { status: result.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { doFetch, seen };
}

const client = (doFetch: typeof fetch) => createDirectoryClient({ accessToken: async () => "cf-token", fetch: doFetch });

async function keysOf() {
  const keys = await publicKeys(await generateIdentity());
  return { ...keys, fingerprint: await fingerprint(keys.encryptionKey, keys.signingKey) };
}

describe("directory client", () => {
  it("registers and unregisters with the bearer access token", async () => {
    const { doFetch, seen } = fakeFetch(() => ({ status: 200, json: { ok: true } }));
    const registration = { inboxUrl: "https://relay.example", inboxToken: "tok", encryptionKey: "e", signingKey: "s" };
    await client(doFetch).register(registration);
    await client(doFetch).unregister();
    expect(seen).toEqual([
      { url: `${DIRECTORY_URL}/register`, method: "POST", auth: "Bearer cf-token", body: registration },
      { url: `${DIRECTORY_URL}/unregister`, method: "POST", auth: "Bearer cf-token", body: undefined },
    ]);
    expect(DIRECTORY_URL).toBe("https://labshelf.org/api/directory");
  });

  it("looks up a recipient's keys and gives undefined for not_found", async () => {
    const keys = await keysOf();
    const { doFetch, seen } = fakeFetch((_url, body) =>
      (body as { email: string }).email === "ada@example.org" ? { status: 200, json: keys } : { status: 404, json: { error: "not_found" } });
    await expect(client(doFetch).lookup("ada@example.org")).resolves.toEqual(keys);
    await expect(client(doFetch).lookup("bob@example.org")).resolves.toBeUndefined();
    expect(seen[0]).toMatchObject({ url: `${DIRECTORY_URL}/lookup`, auth: "Bearer cf-token", body: { email: "ada@example.org" } });
  });

  it("refuses a lookup answer whose fingerprint does not name its keys", async () => {
    const keys = await keysOf();
    const { doFetch } = fakeFetch(() => ({ status: 200, json: { ...keys, fingerprint: "AAAAAAAAAAAAAAAAAAAAAA" } }));
    await expect(client(doFetch).lookup("ada@example.org")).rejects.toBeInstanceOf(DirectoryError);
  });

  it("sends a sealed invite and maps not_found on send to an error", async () => {
    const sealed = { v: 1, to: "fp", expires: 1 };
    const { doFetch, seen } = fakeFetch((_url, body) =>
      (body as { email: string }).email === "ada@example.org" ? { status: 200, json: { ok: true } } : { status: 404, json: { error: "not_found" } });
    await client(doFetch).send("ada@example.org", sealed);
    expect(seen[0]).toMatchObject({ url: `${DIRECTORY_URL}/send`, body: { email: "ada@example.org", sealed } });
    await expect(client(doFetch).send("bob@example.org", sealed)).rejects.toMatchObject({ reason: "not_found" });
  });

  it.each(["unauthorized", "rate_limited", "too_large", "bad_request", "unavailable"])("maps %s to a DirectoryError with that reason", async (code) => {
    const { doFetch } = fakeFetch(() => ({ status: 400, json: { error: code } }));
    const error = await client(doFetch).register({ inboxUrl: "u", inboxToken: "t", encryptionKey: "e", signingKey: "s" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DirectoryError);
    expect(error).toMatchObject({ reason: code });
  });

  it("reads an unknown code as a refusal and a failed request or server error as unavailable", async () => {
    await expect(client(fakeFetch(() => ({ status: 400, json: { error: "weird" } })).doFetch).unregister()).rejects.toMatchObject({ reason: "refused" });
    await expect(client(fakeFetch(() => "network").doFetch).unregister()).rejects.toMatchObject({ reason: "unavailable" });
    await expect(client(fakeFetch(() => ({ status: 502, json: "x" })).doFetch).unregister()).rejects.toMatchObject({ reason: "unavailable" });
  });
});

describe("directory client self", () => {
  it("2.3c posts to /self with the bearer token and returns the relay URL", async () => {
    const { doFetch, seen } = fakeFetch(() => ({ status: 200, json: { relayUrl: "https://relay.example.workers.dev" } }));
    await expect(client(doFetch).self()).resolves.toBe("https://relay.example.workers.dev");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ url: `${DIRECTORY_URL}/self`, method: "POST", auth: "Bearer cf-token" });
  });

  it("2.3c gives undefined for not_found", async () => {
    const { doFetch } = fakeFetch(() => ({ status: 404, json: { error: "not_found" } }));
    await expect(client(doFetch).self()).resolves.toBeUndefined();
  });

  it.each(["unauthorized", "rate_limited"])("2.3c throws a DirectoryError with reason %s", async (code) => {
    const { doFetch } = fakeFetch(() => ({ status: code === "unauthorized" ? 401 : 429, json: { error: code } }));
    const error = await client(doFetch).self().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DirectoryError);
    expect(error).toMatchObject({ reason: code });
  });

  it("2.3c throws unavailable when the request fails", async () => {
    await expect(client(fakeFetch(() => "network").doFetch).self()).rejects.toMatchObject({ reason: "unavailable" });
  });
});
